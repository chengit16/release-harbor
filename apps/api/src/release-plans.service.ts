/** @description 发布计划控制面，服务端冻结安全快照并产生限定确认；不解析凭据或调用商店；执行协调另行原子消费。 */
import { randomUUID } from 'node:crypto'
import {
  isReleasePlanSnapshot,
  type CreateReleasePlan,
  type ReleasePlan,
  type ReleasePlanView,
} from '@release-harbor/contracts'
import {
  ApplicationCatalog,
  DomainError,
  configurationFingerprint,
  notesFingerprint,
  planFingerprint,
  releasePlanView,
  validatePlanDecision,
  validateReleasePlanInput,
} from '@release-harbor/domain'
import type { ArtifactsService } from './artifacts.service.ts'
import type { PreflightsService } from './preflights.service.ts'
import { FileReleasePlanStore } from './release-plan-store.ts'

/** 精确本机来源与摘要校验限定本轮确认；一次性消费由独立执行用例负责。 */
export class ReleasePlansService {
  constructor(
    private readonly applications: ApplicationCatalog,
    private readonly artifacts: ArtifactsService,
    private readonly preflights: PreflightsService,
    private readonly store: FileReleasePlanStore,
    private readonly origins: readonly string[],
    private readonly now: () => number = Date.now,
  ) {}

  /** 写接口不接受无来源脚本或跨站调用；不把本地来源保护当在线认证。 */
  assertSource(origin: unknown, marker: unknown): void {
    if (typeof origin !== 'string' || !this.origins.includes(origin) || marker !== '1')
      throw new DomainError('请从本机工作台进行计划操作', 403)
  }
  /** 查询只重算依赖及字节，不运行商店鉴权，不改写历史确认。 */
  async list(
    workspaceId: string,
    projectId: string,
    applicationId: string,
  ): Promise<ReleasePlanView[]> {
    await this.applications.get(workspaceId, projectId, applicationId)
    const plans = await this.store.list(workspaceId, projectId, applicationId)
    if (!plans.length) return []
    return this.currentViews(workspaceId, projectId, applicationId, plans)
  }

  private async currentViews(
    workspaceId: string,
    projectId: string,
    applicationId: string,
    plans: ReleasePlan[],
  ): Promise<ReleasePlanView[]> {
    const checks = await this.preflights.list(workspaceId, projectId, applicationId)
    const application = await this.applications.get(workspaceId, projectId, applicationId)
    const bindings = await this.applications.bindings(workspaceId, projectId, applicationId)
    const artifacts = await this.artifacts.list(workspaceId, projectId, applicationId)
    return plans.map((plan) => {
      const view = releasePlanView(
        plan,
        checks.find((v) => v.record.id === plan.snapshot.preflight.id),
        this.now(),
      )
      if (!view?.current) return view
      // 目录版本和实际字节由预检查询复核，其他公开配置也逐项比对，不能只依赖 revision。
      const binding = bindings.find((b) => b.id === plan.snapshot.binding.id)
      const artifact = artifacts.find((a) => a.id === plan.snapshot.artifact.id)
      const invalidatedBy =
        planFingerprint(application) !== planFingerprint(plan.snapshot.application) ||
        planFingerprint(binding) !== planFingerprint(plan.snapshot.binding)
          ? 'binding_changed'
          : planFingerprint(artifact) !== planFingerprint(plan.snapshot.artifact)
            ? 'artifact_changed'
            : null
      return { plan, current: invalidatedBy === null, invalidatedBy }
    })
  }

  /** 执行协调在消费及远端许可前复验，调用者必须避免再次读取计划 Store 造成队列死锁。 */
  async assertExecutable(plan: ReleasePlan): Promise<void> {
    if (
      plan.status !== 'confirmed' ||
      !plan.authorization ||
      plan.authorization.planDigest !== plan.digest ||
      this.now() >= Date.parse(plan.authorization.expiresAt)
    )
      throw new DomainError('计划尚未确认或确认已过期', 409)
    const a = plan.snapshot.application
    const view = (await this.currentViews(a.workspaceId, a.projectId, a.id, [plan]))[0]
    if (!view?.current) throw new DomainError('计划已失效，请重新预检并冻结', 409)
  }

  /** 固定预检的真实快照，重复请求只返回同意图，不使用新配置覆盖。 */
  async freeze(
    workspaceId: string,
    projectId: string,
    applicationId: string,
    body: unknown,
  ): Promise<ReleasePlan> {
    const input = validateReleasePlanInput(body)
    await this.applications.get(workspaceId, projectId, applicationId)
    return this.store.create(input.requestId, async (previous) => {
      if (previous) {
        const s = previous.snapshot
        if (
          s.application.workspaceId !== workspaceId ||
          s.application.projectId !== projectId ||
          s.application.id !== applicationId ||
          s.preflight.id !== input.preflightId ||
          s.action !== input.action ||
          s.releaseNotes !== input.releaseNotes ||
          planFingerprint(s.xiaomi ?? null) !== planFingerprint(input.xiaomi ?? null)
        )
          throw new DomainError('该请求已对应另一份计划，请重新核对', 409)
        return previous
      }
      return this.build(workspaceId, projectId, applicationId, input)
    })
  }

  private async build(
    workspaceId: string,
    projectId: string,
    applicationId: string,
    input: CreateReleasePlan,
  ): Promise<ReleasePlan> {
    // 1. 先核对当前通过预检；其中会复核实际磁盘字节及凭据目录，不请求商店。
    const view = (await this.preflights.list(workspaceId, projectId, applicationId)).find(
      (v) => v.record.id === input.preflightId,
    )
    if (!view?.current || !view.record.expiresAt || this.now() >= Date.parse(view.record.expiresAt))
      throw new DomainError('请选择当前通过且未过期的只读预检', 409)
    // 2. 快照仅取服务端存储，客户端不能替换目标、产物摘要或账号引用。
    const application = await this.applications.get(workspaceId, projectId, applicationId)
    const binding = (await this.applications.bindings(workspaceId, projectId, applicationId)).find(
      (b) => b.id === view.record.bindingId,
    )
    const artifact = await this.artifacts.get(
      workspaceId,
      projectId,
      applicationId,
      view.record.artifactId,
    )
    if (!binding) throw new DomainError('商店绑定已变化，请重新预检', 409)
    const base = { application, binding, artifact, preflight: view.record }
    const snapshot = {
      ...base,
      action: input.action,
      releaseNotes: input.releaseNotes,
      ...(input.xiaomi ? { xiaomi: input.xiaomi } : {}),
      notesDigest: notesFingerprint(input.releaseNotes),
      configDigest: configurationFingerprint(base),
    }
    if (!isReleasePlanSnapshot(snapshot))
      throw new DomainError('动作、商店或预检依赖不匹配，请重新核对', 409)
    // 3. 冻结不确认、不派发；后续确认及执行仍须重新核对依赖。
    return {
      id: randomUUID(),
      requestId: input.requestId,
      snapshot,
      digest: planFingerprint(snapshot),
      createdAt: new Date(this.now()).toISOString(),
      status: 'frozen',
      authorization: null,
      cancelledAt: null,
    }
  }

  /** 确认限定摘要、动作、本地范围及期限；并发重复确认不延长授权。 */
  confirm(
    workspaceId: string,
    projectId: string,
    applicationId: string,
    id: string,
    body: unknown,
  ): Promise<ReleasePlan> {
    const digest = validatePlanDecision(body, true)
    return this.store.update(workspaceId, projectId, applicationId, id, async (plan) => {
      if (digest !== plan.digest) throw new DomainError('计划摘要不一致，请重新读取并核对', 409)
      return this.authorize(plan)
    })
  }

  /** 仅构造并核验限定确认，不自行写盘；执行用例必须与消费同队列提交。 */
  async authorize(plan: ReleasePlan): Promise<ReleasePlan> {
    const { workspaceId, projectId, id: applicationId } = plan.snapshot.application
    const view = (await this.currentViews(workspaceId, projectId, applicationId, [plan]))[0]
    if (!view?.current) throw new DomainError('计划已失效，请重新预检并冻结新计划', 409)
    if (plan.status === 'confirmed') return plan
    const now = this.now()
    const expiresAt = Math.min(now + 300000, Date.parse(plan.snapshot.preflight.expiresAt ?? ''))
    if (!(expiresAt > now)) throw new DomainError('预检已过期，请重新预检', 409)
    return {
      ...plan,
      status: 'confirmed',
      authorization: {
        id: randomUUID(),
        planDigest: plan.digest,
        scope: 'local_once',
        issuedAt: new Date(now).toISOString(),
        expiresAt: new Date(expiresAt).toISOString(),
      },
    }
  }

  /** 取消只撤销未消费的本地意图及授权，已执行操作不提供撤回；重复取消保持同一事实。 */
  cancel(
    workspaceId: string,
    projectId: string,
    applicationId: string,
    id: string,
    body: unknown,
  ): Promise<ReleasePlan> {
    const digest = validatePlanDecision(body, false)
    return this.store.update(workspaceId, projectId, applicationId, id, async (plan) => {
      if (digest !== plan.digest) throw new DomainError('计划摘要不一致，请重新读取并核对', 409)
      return plan.status === 'cancelled'
        ? plan
        : { ...plan, status: 'cancelled', cancelledAt: new Date(this.now()).toISOString() }
    })
  }
}
