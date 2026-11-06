/** @description Apple 审核控制用例；仅管理安全快照与一次性消费，网络及秘密隔离到可信 worker。 */
import { randomUUID } from 'node:crypto'
import { ApplicationCatalog, DomainError, planFingerprint } from '@release-harbor/domain'
import {
  isRecord,
  hasExactKeys,
  isPlanId,
  isAppleResourceId,
  isAppleReviewCatalog,
  isAppleReviewSnapshot,
  appleReviewMessages,
  type AppleReviewRecord,
  type AppleReviewSnapshot,
  type AppleReviewCatalog,
  type ChannelBinding,
  type AppleReviewCode,
} from '@release-harbor/contracts'
import type { AppleReviewRunner, AppleReviewReply } from '@release-harbor/runner-local'
import { activeBatch } from './release-batch-invariants.ts'
import { FileReleasePlanStore } from './release-plan-store.ts'
import { PreflightsService } from './preflights.service.ts'

/** 与上传共用同文件写队列和执行槽；查询不自动触发商店动作，重启只恢复事实。 */
export class AppleReviewService {
  private ready: Promise<unknown>
  private closed = false
  private jobs = new Set<Promise<void>>()
  constructor(
    private readonly applications: ApplicationCatalog,
    private readonly profiles: Pick<PreflightsService, 'profiles'>,
    private readonly store: FileReleasePlanStore,
    private readonly runner: AppleReviewRunner,
    private readonly now: () => number = Date.now,
  ) {
    this.ready = store.execution(async (_p, _a, _q, records) => {
      for (const r of records)
        if (r.status === 'running') {
          r.status = r.remoteStartedAt ? 'unknown' : 'interrupted'
          r.code = r.remoteStartedAt ? 'unknown' : 'interrupted'
          r.finishedAt = new Date(
            Math.max(this.now(), Date.parse(r.remoteStartedAt ?? r.consumedAt ?? r.createdAt)),
          ).toISOString()
        }
    })
    void this.ready.catch(() => undefined)
  }
  private async target(
    project: string,
    application: string,
    bindingId: string,
  ): Promise<{ binding: ChannelBinding; identifier: string; revision: string }> {
    const app = await this.applications.get('local', project, application)
    const binding = (await this.applications.bindings('local', project, application)).find(
      (b) => b.id === bindingId && b.channel === 'app_store',
    )
    if (app.platform !== 'ios' || !binding) throw new DomainError('当前 iOS Apple 绑定不存在', 404)
    const profile = (await this.profiles.profiles()).profiles.find(
      (p) =>
        p.reference === binding.credentialReference && p.channel === 'app_store' && p.configured,
    )
    if (!profile) throw new DomainError(appleReviewMessages.credentials, 409)
    return { binding, identifier: app.identifier, revision: profile.revision }
  }
  private value(reply: AppleReviewReply): Extract<AppleReviewReply, { ok: true }>['value'] {
    if (!reply.ok) throw new DomainError(appleReviewMessages[reply.code], 409)
    return reply.value
  }
  private scoped(r: AppleReviewRecord, project: string, application: string): boolean {
    return (
      r.snapshot.binding.workspaceId === 'local' &&
      r.snapshot.binding.projectId === project &&
      r.snapshot.binding.applicationId === application
    )
  }
  /** 历史只读，不会隐式请求商店或续期。 */
  async list(project: string, application: string): Promise<AppleReviewRecord[]> {
    await this.ready
    await this.applications.get('local', project, application)
    return this.store.execution(async (_p, _a, _q, records) =>
      structuredClone(records.filter((r) => this.scoped(r, project, application)).reverse()),
    )
  }
  /** 显式只读刷新目录，并为相同版本附加观察时间，不改写执行回执。 */
  async catalog(project: string, application: string, body: unknown): Promise<AppleReviewCatalog> {
    if (!isRecord(body) || !hasExactKeys(body, ['bindingId']) || !isPlanId(body.bindingId))
      throw new DomainError('请选择 Apple 绑定')
    await this.ready
    const t = await this.target(project, application, body.bindingId)
    const value = this.value(
      await this.runner.run({ kind: 'catalog', binding: t.binding, identifier: t.identifier }),
    )
    if (
      !isAppleReviewCatalog(value) ||
      value.appId !== t.binding.appId ||
      value.identifier !== t.identifier
    )
      throw new DomainError('Apple 查询返回不匹配', 503)
    await this.store.execution(async (_p, _a, _q, records) => {
      for (const r of records)
        if (this.scoped(r, project, application) && r.snapshot.binding.id === t.binding.id) {
          const v = value.versions.find((v) => v.id === r.snapshot.version.id)
          if (v) r.observation = { state: v.state, checkedAt: value.checkedAt }
        }
    })
    return value
  }
  /** 准备仅查询，快照服务端生成；相同请求不重新查询或延长期限。 */
  async prepare(project: string, application: string, body: unknown): Promise<AppleReviewRecord> {
    if (
      !isRecord(body) ||
      !hasExactKeys(body, [
        'requestId',
        'bindingId',
        'buildId',
        'versionId',
        'action',
        'mode',
        'notes',
      ]) ||
      !isPlanId(body.requestId) ||
      !isPlanId(body.bindingId) ||
      !isAppleResourceId(body.buildId) ||
      !isAppleResourceId(body.versionId) ||
      (body.action !== 'submit' && body.action !== 'release') ||
      (body.mode !== 'manual' && body.mode !== 'after_approval') ||
      typeof body.notes !== 'string' ||
      body.notes.length > 4000 ||
      /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(body.notes) ||
      (body.action === 'submit' && !body.notes.trim()) ||
      (body.action === 'release' && (body.notes !== '' || body.mode !== 'manual'))
    )
      throw new DomainError('请选择构建、对应版本及自动／手动发布，填写更新说明')
    await this.ready
    // 1. 固定公开意图与请求编号，响应丢失时不重新准备或延长原期限。
    const input = {
      requestId: body.requestId,
      bindingId: body.bindingId,
      buildId: body.buildId,
      versionId: body.versionId,
      action: body.action,
      mode: body.mode,
      notes: body.notes.trim(),
    } as const
    const same = (r: AppleReviewRecord): boolean =>
      this.scoped(r, project, application) &&
      r.snapshot.binding.id === input.bindingId &&
      r.snapshot.build.id === input.buildId &&
      r.snapshot.version.id === input.versionId &&
      r.snapshot.action === input.action &&
      r.snapshot.mode === input.mode &&
      r.snapshot.notes === input.notes
    const previous = (await this.list(project, application)).find(
      (r) => r.requestId === input.requestId,
    )
    if (previous) {
      if (!same(previous)) throw new DomainError('请求编号已用于其他意图', 409)
      return previous
    }
    // 2. 可信 worker 生成来源，控制面再次匹配所有目标与材料目录版本。
    const t = await this.target(project, application, input.bindingId)
    const value = this.value(
      await this.runner.run({
        kind: 'prepare',
        binding: t.binding,
        identifier: t.identifier,
        buildId: input.buildId,
        versionId: input.versionId,
        action: input.action,
        mode: input.mode,
        notes: input.notes,
      }),
    )
    if (
      !isAppleReviewSnapshot(value) ||
      planFingerprint(value.binding) !== planFingerprint(t.binding) ||
      value.identifier !== t.identifier ||
      value.profileRevision !== t.revision ||
      value.build.id !== input.buildId ||
      value.version.id !== input.versionId ||
      value.action !== input.action ||
      value.mode !== input.mode ||
      value.notes !== input.notes ||
      Math.abs(this.now() - Date.parse(value.checkedAt)) > 300000
    )
      throw new DomainError('Apple 准备结果不匹配或已过期', 409)
    // 3. 同文件串行冻结，重复并发请求返回原事实，不触发商店写入。
    const now = this.now(),
      r: AppleReviewRecord = {
        id: randomUUID(),
        requestId: input.requestId,
        snapshot: value,
        digest: planFingerprint(value),
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(
          Math.min(now + 300000, Date.parse(value.checkedAt) + 300000),
        ).toISOString(),
        status: 'ready',
        code: 'ready',
        consumedAt: null,
        remoteStartedAt: null,
        finishedAt: null,
      }
    return this.store.execution(async (_p, _a, _q, records) => {
      const old = records.find((r) => r.requestId === input.requestId)
      if (old) {
        if (!same(old)) throw new DomainError('请求编号已用于其他意图', 409)
        return structuredClone(old)
      }
      records.push(r)
      return structuredClone(r)
    })
  }
  private async current(r: AppleReviewRecord): Promise<void> {
    if (this.closed || this.now() >= Date.parse(r.expiresAt))
      throw new DomainError(appleReviewMessages.expired, 409)
    const t = await this.target(
      r.snapshot.binding.projectId,
      r.snapshot.binding.applicationId,
      r.snapshot.binding.id,
    )
    if (
      t.identifier !== r.snapshot.identifier ||
      t.revision !== r.snapshot.profileRevision ||
      planFingerprint(t.binding) !== planFingerprint(r.snapshot.binding)
    )
      throw new DomainError(appleReviewMessages.changed, 409)
  }
  /** 原子消费和执行槽占用在同文件；响应重复只返回原记录，不再次派发。 */
  async execute(
    project: string,
    application: string,
    id: string,
    body: unknown,
  ): Promise<AppleReviewRecord> {
    if (
      !isRecord(body) ||
      !hasExactKeys(body, ['expectedDigest', 'acknowledged']) ||
      body.acknowledged !== true
    )
      throw new DomainError('请核对摘要并明确确认')
    await this.ready
    let launch: AppleReviewRecord | undefined
    const result = await this.store.execution(async (plans, attempts, _q, records, batches) => {
      const r = records.find((r) => r.id === id && this.scoped(r, project, application))
      if (!r) throw new DomainError('审核意图不存在', 404)
      if (body.expectedDigest !== r.digest) throw new DomainError('摘要已变化', 409)
      if (r.consumedAt) return structuredClone(r)
      await this.current(r)
      if (
        batches.some(activeBatch) ||
        attempts.some((a) => a.finishedAt === null) ||
        records.some((v) => v.status === 'running')
      )
        throw new DomainError('本机已有执行进行中', 409)
      if (
        records.some(
          (v) =>
            v.id !== r.id &&
            v.snapshot.binding.appId === r.snapshot.binding.appId &&
            ((v.status === 'unknown' && !v.reconciliation) ||
              (v.reconciliation?.decision === 'present' &&
                v.snapshot.version.id === r.snapshot.version.id &&
                v.snapshot.action === r.snapshot.action) ||
              (v.status === 'succeeded' &&
                v.snapshot.version.id === r.snapshot.version.id &&
                v.snapshot.action === r.snapshot.action)),
        ) ||
        attempts.some(
          (a) =>
            a.status === 'needs_reconciliation' &&
            !a.reconciliation &&
            plans.some(
              (p) =>
                p.id === a.planId &&
                p.snapshot.binding.channel === 'app_store' &&
                p.snapshot.binding.appId === r.snapshot.binding.appId,
            ),
        )
      )
        throw new DomainError('此 Apple 目标存在待核对或已受理操作，请先查看记录', 409)
      r.status = 'running'
      r.code = 'running'
      r.consumedAt = new Date(this.now()).toISOString()
      launch = structuredClone(r)
      return structuredClone(r)
    })
    if (launch) {
      const job = this.run(launch)
      this.jobs.add(job)
      void job.finally(() => this.jobs.delete(job))
    }
    return result
  }
  private async run(record: AppleReviewRecord): Promise<void> {
    let reply: AppleReviewReply = { ok: false, code: 'interrupted' }
    try {
      reply = await this.runner.run({ kind: 'execute', snapshot: record.snapshot }, async () => {
        await this.store.execution(async (_p, _a, _q, records) => {
          const r = records.find((v) => v.id === record.id)
          if (!r || r.status !== 'running' || r.remoteStartedAt) throw Error()
          await this.current(r)
          r.remoteStartedAt = new Date(
            Math.max(this.now(), Date.parse(r.consumedAt ?? r.createdAt)),
          ).toISOString()
        })
      })
    } catch {
      /* 具体异常不越过安全进程边界。 */
    }
    try {
      await this.store.execution(async (_p, _a, _q, records) => {
        const r = records.find((v) => v.id === record.id)
        if (!r || r.status !== 'running') return
        const expected = r.snapshot.action === 'submit' ? 'submitted' : 'release_requested'
        if (r.remoteStartedAt && reply.ok && reply.value === expected) {
          r.status = 'succeeded'
          r.code = expected
        } else {
          r.status = r.remoteStartedAt ? 'unknown' : 'failed'
          r.code = reply.ok ? 'receipt' : reply.code
        }
        r.finishedAt = new Date(
          Math.max(this.now(), Date.parse(r.remoteStartedAt ?? r.consumedAt ?? r.createdAt)),
        ).toISOString()
      })
    } catch {
      /* 不明存储留待启动恢复，不声称回滚商店。 */
    }
  }
  /** 人工核对仅附加声明，不恢复旧授权，不将用户声明当作自动商店状态。 */
  async reconcile(
    project: string,
    application: string,
    id: string,
    body: unknown,
  ): Promise<AppleReviewRecord> {
    if (
      !isRecord(body) ||
      !hasExactKeys(body, ['expectedDigest', 'decision', 'version', 'build', 'acknowledged']) ||
      body.acknowledged !== true ||
      (body.decision !== 'present' && body.decision !== 'absent')
    )
      throw new DomainError('请核对商店实际结果并明确同意')
    const decision = body.decision
    await this.ready
    return this.store.execution(async (_p, _a, _q, records) => {
      const r = records.find((r) => r.id === id && this.scoped(r, project, application))
      if (!r) throw new DomainError('记录不存在', 404)
      if (
        r.digest !== body.expectedDigest ||
        r.snapshot.version.version !== body.version ||
        r.snapshot.build.number !== body.build ||
        r.status !== 'unknown' ||
        !r.finishedAt
      )
        throw new DomainError('仅可核对匹配版本的未知结果', 409)
      if (r.reconciliation) {
        if (r.reconciliation.decision !== body.decision)
          throw new DomainError('不能覆盖原核对结论', 409)
        return structuredClone(r)
      }
      r.reconciliation = {
        decision,
        source: 'local_user',
        checkedAt: new Date(Math.max(this.now(), Date.parse(r.finishedAt))).toISOString(),
      }
      return structuredClone(r)
    })
  }
  /** 停止只终止本机进程；不撤销远端已受理的审核或发布。 */
  async onModuleDestroy(): Promise<void> {
    this.closed = true
    this.runner.close()
    await Promise.allSettled(this.jobs)
  }
}
