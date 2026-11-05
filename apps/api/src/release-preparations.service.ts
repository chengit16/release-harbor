/** @description 发布准备的后台编排；登记后仅运行只读预检与未授权快照，浏览器断开不重放。 */
import { setTimeout as delay } from 'node:timers/promises'
import {
  ApplicationCatalog,
  DomainError,
  planFingerprint,
  validateXiaomiUpdateDetails,
  validateReleasePolicy,
} from '@release-harbor/domain'
import {
  isPrepareReleaseInput,
  type ReleasePreparation,
  type PrepareReleaseInput,
} from '@release-harbor/contracts'
import { FileReleasePlanStore } from './release-plan-store.ts'
import { ReleasePlansService } from './release-plans.service.ts'
import { PreflightsService } from './preflights.service.ts'
import { ArtifactsService } from './artifacts.service.ts'

/** 单进程准备槽及同请求去重；进行中重启标为中断，不重新执行商店查询。 */
export class ReleasePreparationsService {
  private readonly ready: Promise<unknown>
  private readonly jobs = new Set<Promise<void>>()
  private closing = false
  constructor(
    private readonly applications: ApplicationCatalog,
    private readonly artifacts: ArtifactsService,
    private readonly checks: PreflightsService,
    private readonly plans: ReleasePlansService,
    private readonly store: FileReleasePlanStore,
  ) {
    this.ready = store.execution(async (_plans, _attempts, preparations) => {
      for (const p of preparations)
        if (p.status === 'checking')
          Object.assign(p, {
            status: 'interrupted',
            code: 'preparation_interrupted',
            finishedAt: new Date(Math.max(Date.now(), Date.parse(p.createdAt))).toISOString(),
          })
    })
    void this.ready.catch(() => undefined)
  }
  /** 归属检查后查询原进度；不在 GET 中访问商店。 */
  async list(
    workspaceId: string,
    projectId: string,
    applicationId: string,
  ): Promise<ReleasePreparation[]> {
    await this.ready
    await this.applications.get(workspaceId, projectId, applicationId)
    return this.store.preparations(workspaceId, projectId, applicationId)
  }
  /** 完整校验与去重在同队列内完成；只有首次受理才启动后台检查。 */
  async start(
    workspaceId: string,
    projectId: string,
    applicationId: string,
    body: unknown,
  ): Promise<ReleasePreparation> {
    if (!isPrepareReleaseInput(body))
      throw new DomainError('请选择商店绑定与安装包，并填写更新说明')
    const input: PrepareReleaseInput = structuredClone(body)
    await this.ready
    let profileRevision: string | null = null
    const record = await this.store.execution(async (plans, _attempts, preparations) => {
      const previous = preparations.find((p) => p.id === input.requestId)
      if (previous) {
        if (
          previous.workspaceId !== workspaceId ||
          previous.projectId !== projectId ||
          previous.applicationId !== applicationId ||
          planFingerprint(previous.input) !== planFingerprint(input)
        )
          throw new DomainError('此请求已对应另一份发布准备', 409)
        return structuredClone(previous)
      }
      // 1. 来源由 Controller 保护；这里再次检查父级、版本、格式和当前支持动作。
      if (this.closing) throw new DomainError('发布准备服务正在停止', 503)
      const application = await this.applications.get(workspaceId, projectId, applicationId)
      const binding = (
        await this.applications.bindings(workspaceId, projectId, applicationId)
      ).find((b) => b.id === input.bindingId)
      const artifact = await this.artifacts.get(
        workspaceId,
        projectId,
        applicationId,
        input.artifactId,
      )
      if (!binding) throw new DomainError('商店绑定不存在', 404)
      if (
        !['huawei', 'xiaomi', 'oppo', 'vivo', 'meizu', 'honor', 'app_store'].includes(
          binding.channel,
        )
      )
        throw new DomainError('此渠道尚未接入发布准备', 409)
      if (binding.channel === 'meizu' && input.releasePolicy?.mode !== 'after_approval')
        throw new DomainError('魅族公开 API 暂不支持指定时间，请选择立即上架或到商店后台操作')
      if (binding.channel === 'honor' && input.releaseNotes.length > 500)
        throw new DomainError('荣耀更新说明最多 500 字')
      if (input.releasePolicy) validateReleasePolicy(input.releasePolicy)
      if (
        binding.channel === 'vivo' &&
        (Array.from(input.releaseNotes).length < 5 || Array.from(input.releaseNotes).length > 200)
      )
        throw new DomainError('vivo 更新说明须为 5–200 字')
      if (binding.channel === 'oppo' && Array.from(input.releaseNotes).length < 5)
        throw new DomainError('OPPO 更新说明至少填写 5 个字')
      if (input.xiaomi?.source) throw new DomainError('商店资料来源仅能由独立执行器确认')
      if (binding.channel === 'xiaomi' && input.xiaomi) validateXiaomiUpdateDetails(input.xiaomi)
      else if (binding.channel !== 'xiaomi' && input.xiaomi)
        throw new DomainError('当前渠道不接受小米资料')
      if (
        binding.revision !== input.expectedBindingRevision ||
        artifact.sha256 !== input.expectedArtifactSha256 ||
        artifact.status !== 'ready'
      )
        throw new DomainError('绑定或安装包已变化，请重新读取并选择', 409)
      if (preparations.some((p) => p.status === 'checking'))
        throw new DomainError('已有发布准备进行中，请等待原结果', 409)
      if (plans.some((p) => p.requestId === input.requestId))
        throw new DomainError('请求编号已被另一份计划使用', 409)
      const catalog = await this.checks.profiles()
      const profile = catalog.profiles.find(
        (p) =>
          p.reference === binding.credentialReference &&
          p.channel === binding.channel &&
          p.configured,
      )
      if (!profile) throw new DomainError('商店账号不可用，请到商店账号核对后重新准备', 409)
      profileRevision = profile.revision
      const result: ReleasePreparation = {
        id: input.requestId,
        workspaceId,
        projectId,
        applicationId,
        input,
        status: 'checking',
        code: 'checking',
        preflightId: null,
        planId: null,
        createdAt: new Date().toISOString(),
        finishedAt: null,
      }
      preparations.push(result)
      return structuredClone(result)
    })
    // 2. 响应丢失或重复点击只返回原记录；没有确认或远端写入。
    if (profileRevision !== null) {
      const job = this.run(record, profileRevision)
      this.jobs.add(job)
      void job.finally(() => this.jobs.delete(job))
    }
    return record
  }
  private async run(record: ReleasePreparation, profileRevision: string): Promise<void> {
    let code: ReleasePreparation['code'] = 'preparation_failed'
    const { workspaceId, projectId, applicationId, input } = record
    try {
      // 3. 先登记只读预检，再关联其编号；中途停止也不会自动恢复或重放。
      const check = await this.checks.start(workspaceId, projectId, applicationId, {
        bindingId: input.bindingId,
        artifactId: input.artifactId,
        expectedBindingRevision: input.expectedBindingRevision,
        expectedProfileRevision: profileRevision,
      })
      await this.store.execution(async (_plans, _attempts, preparations) => {
        const current = preparations.find((p) => p.id === record.id)
        if (current?.status === 'checking') current.preflightId = check.id
      })
      const deadline = Date.now() + 90000
      while (!this.closing && Date.now() < deadline) {
        const result = await this.checks.record(workspaceId, projectId, applicationId, check.id)
        if (!result || result.status === 'running') {
          await delay(250)
          continue
        }
        if (result.status !== 'passed') {
          code =
            result.code === 'running' || result.code === 'verified'
              ? 'preparation_failed'
              : result.code
          break
        }
        // 4. 冻结仍重验真实依赖；准备通过不生成授权，只有后续明确确认才执行。
        code = 'dependency_changed'
        if (result.artifactSha256 !== input.expectedArtifactSha256) break
        const binding = (
          await this.applications.bindings(workspaceId, projectId, applicationId)
        ).find((b) => b.id === input.bindingId)
        const plan = await this.plans.freeze(workspaceId, projectId, applicationId, {
          requestId: record.id,
          preflightId: check.id,
          action:
            binding?.channel === 'app_store'
              ? 'apple_upload_build'
              : binding?.channel === 'meizu'
                ? 'meizu_submit_review'
                : binding?.channel === 'honor'
                  ? 'honor_submit_review'
                  : binding?.channel === 'vivo'
                    ? 'vivo_submit_review'
                    : binding?.channel === 'oppo'
                      ? 'oppo_submit_review'
                      : binding?.channel === 'xiaomi'
                        ? 'xiaomi_submit_review'
                        : 'huawei_save_draft',
          ...(input.releasePolicy ? { releasePolicy: input.releasePolicy } : {}),
          ...(input.xiaomi ? { xiaomi: input.xiaomi } : {}),
          releaseNotes: input.releaseNotes,
        })
        await this.store.execution(async (_plans, _attempts, preparations) => {
          const current = preparations.find((p) => p.id === record.id)
          if (current?.status === 'checking')
            Object.assign(current, {
              status: 'ready',
              code: 'ready',
              planId: plan.id,
              finishedAt: new Date(
                Math.max(Date.now(), Date.parse(record.createdAt)),
              ).toISOString(),
            })
        })
        return
      }
    } catch {
      /* 只保存固定阶段码，不将 SDK 或内部异常写入公开准备记录。 */
    }
    try {
      await this.store.execution(async (_plans, _attempts, preparations) => {
        const current = preparations.find((p) => p.id === record.id)
        if (current?.status === 'checking')
          Object.assign(current, {
            status: this.closing ? 'interrupted' : 'failed',
            code: this.closing ? 'preparation_interrupted' : code,
            finishedAt: new Date(Math.max(Date.now(), Date.parse(record.createdAt))).toISOString(),
          })
      })
    } catch {
      /* 写盘失败保留进行中事实，重启只恢复中断，不自动重放。 */
    }
  }
  /** 停止只读等待，准备流程不曾取得商店写入授权。 */
  async onModuleDestroy(): Promise<void> {
    this.closing = true
    await Promise.allSettled(this.jobs)
  }
}
