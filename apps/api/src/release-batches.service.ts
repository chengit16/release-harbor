/** @description 同应用批次控制面；草稿、逐项准备和一次限定确认，远端写入交给可信独立执行器。 */
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import {
  batchChannels,
  hasExactKeys,
  isRecord,
  isPlanId,
  isCreateReleaseBatchInput,
  isBatchTargets,
  preparationMessages,
  type ReleaseBatch,
  type BatchRevision,
  type BatchTargetInput,
} from '@release-harbor/contracts'
import { ApplicationCatalog, DomainError, planFingerprint } from '@release-harbor/domain'
import type { ArtifactsService } from './artifacts.service.ts'
import type { ReleasePreparationsService } from './release-preparations.service.ts'
import type { ReleasePlansService } from './release-plans.service.ts'
import type { ReleaseExecutionService } from './release-execution.service.ts'
import { FileReleasePlanStore } from './release-plan-store.ts'
import { activeBatch, batchDigest } from './release-batch-invariants.ts'
import {
  dispatchBatch,
  assertBatchTargetUnblocked,
  recoverBatches,
} from './release-batch-dispatch.ts'

/** 单进程队列是写入边界；刷新只读原事实，服务重启从不重放批次。 */
export class ReleaseBatchesService {
  private readonly ready: Promise<unknown>
  private readonly jobs = new Set<Promise<void>>()
  private closed = false
  constructor(
    private readonly applications: ApplicationCatalog,
    private readonly artifacts: ArtifactsService,
    private readonly preparations: ReleasePreparationsService,
    private readonly plans: ReleasePlansService,
    private readonly execution: ReleaseExecutionService,
    private readonly store: FileReleasePlanStore,
    private readonly now: () => number = Date.now,
  ) {
    this.ready = store.execution(async (_p, attempts, _q, _a, batches) =>
      recoverBatches(batches, attempts, this.now()),
    )
    void this.ready.catch(() => undefined)
  }
  private scoped(b: ReleaseBatch, w: string, p: string, a: string): boolean {
    return b.workspaceId === w && b.projectId === p && b.applicationId === a
  }
  private spawn(work: Promise<void>): void {
    this.jobs.add(work)
    void work.catch(() => undefined).finally(() => this.jobs.delete(work))
  }
  /** 返回应用内安全历史；不会恢复任务、请求商店或延长确认。 */
  async list(w: string, p: string, a: string): Promise<ReleaseBatch[]> {
    await this.ready
    await this.applications.get(w, p, a)
    return this.store.batches(w, p, a)
  }
  /** 完整父级范围是访问条件，知道批次编号不能越权。 */
  async get(w: string, p: string, a: string, id: string): Promise<ReleaseBatch> {
    const b = (await this.list(w, p, a)).find((b) => b.id === id)
    if (!b) throw new DomainError('批次不存在', 404)
    return b
  }
  /** 幂等保存公开草稿，不进行商店查询，也不创建授权。 */
  async create(w: string, p: string, a: string, body: unknown): Promise<ReleaseBatch> {
    if (!isCreateReleaseBatchInput(body))
      throw new DomainError('请选择 1–7 个不同渠道，并完整填写安装包、说明和上架方式')
    await this.ready
    const app = await this.applications.get(w, p, a)
    if (app.platform !== 'android') throw new DomainError('首版批次仅支持同一个 Android 应用')
    const targets = this.normalized(body.targets)
    const requestId = body.requestId
    return this.store.execution(async (_p, _a, _q, _apple, batches) => {
      const old = batches.find((b) => b.requestId === body.requestId)
      if (old) {
        if (!this.scoped(old, w, p, a) || planFingerprint(old.draft) !== planFingerprint(targets))
          throw new DomainError('请求编号已对应其他批次', 409)
        return structuredClone(old)
      }
      const b: ReleaseBatch = {
        id: randomUUID(),
        requestId,
        workspaceId: w,
        projectId: p,
        applicationId: a,
        editVersion: 1,
        draft: targets,
        createdAt: new Date(this.now()).toISOString(),
        revisions: [],
      }
      batches.push(b)
      return structuredClone(b)
    })
  }
  private normalized(targets: BatchTargetInput[]): BatchTargetInput[] {
    return structuredClone(targets).map((t) => ({ ...t, releaseNotes: t.releaseNotes.trim() }))
  }
  /** 修改只影响草稿；准备／运行中的批次不能覆盖，历史版本只读保留。 */
  async edit(w: string, p: string, a: string, id: string, body: unknown): Promise<ReleaseBatch> {
    if (
      !isRecord(body) ||
      !hasExactKeys(body, ['expectedRevision', 'targets']) ||
      !isBatchTargets(body.targets)
    )
      throw new DomainError('请提供完整草稿和预期版本')
    await this.ready
    const targets = this.normalized(body.targets)
    return this.store.execution(async (_p, _a, _q, _apple, batches) => {
      const b = batches.find((b) => b.id === id && this.scoped(b, w, p, a))
      if (!b) throw new DomainError('批次不存在', 404)
      if (b.editVersion !== body.expectedRevision || activeBatch(b))
        throw new DomainError('批次已变化或正在处理，请重新读取', 409)
      b.draft = targets
      b.editVersion++
      return structuredClone(b)
    })
  }
  /** 逐项准备共用旧单准备槽；先预约请求，再在后台核验，不循环旧写接口。 */
  async prepare(w: string, p: string, a: string, id: string, body: unknown): Promise<ReleaseBatch> {
    if (
      !isRecord(body) ||
      !hasExactKeys(body, ['expectedRevision', 'requestId']) ||
      !isPlanId(body.requestId)
    )
      throw new DomainError('请提供草稿版本和请求编号')
    const requestId = body.requestId
    await this.ready
    let revisionId: string | null = null
    const result = await this.store.execution(async (_saved, attempts, q, apple, batches) => {
      const b = batches.find((b) => b.id === id && this.scoped(b, w, p, a))
      if (!b) throw new DomainError('批次不存在', 404)
      if (b.revisions.some((r) => r.requestId === body.requestId)) return structuredClone(b)
      if (this.closed || b.editVersion !== body.expectedRevision)
        throw new DomainError('草稿已变化，请重新读取', 409)
      if (
        batches.some(activeBatch) ||
        q.some((q) => q.status === 'checking') ||
        attempts.some((a) => !a.finishedAt) ||
        apple.some((a) => a.status === 'running')
      )
        throw new DomainError('本机已有准备或执行进行中，请等待结果', 409)
      // 同应用与版本约束在访问商店前完整检查，不凭文件名猜测渠道包。
      const bindings = await this.applications.bindings(w, p, a),
        versions = new Set<string>(),
        channels = new Set<string>()
      for (const t of b.draft) {
        const binding = bindings.find((b) => b.id === t.bindingId),
          artifact = await this.artifacts.get(w, p, a, t.artifactId)
        if (
          !binding ||
          !batchChannels.some((c) => c === binding.channel) ||
          channels.has(binding.channel) ||
          artifact.format !== 'apk' ||
          artifact.status !== 'ready' ||
          !artifact.identity ||
          artifact.sha256 !== t.expectedArtifactSha256 ||
          binding.revision !== t.expectedBindingRevision
        )
          throw new DomainError('批次绑定或安装包已变化，请重新选择', 409)
        channels.add(binding.channel)
        versions.add(artifact.identity.versionName)
      }
      if (versions.size !== 1) throw new DomainError('同一批次 APK 的版本名称必须一致，请拆分版本')
      const r: BatchRevision = {
        id: randomUUID(),
        requestId,
        createdAt: new Date(this.now()).toISOString(),
        preparedAt: null,
        digest: null,
        run: null,
        targets: b.draft.map((input) => ({
          id: randomUUID(),
          input: structuredClone(input),
          preparationId: randomUUID(),
          planId: null,
          status: 'pending',
          message: '等待只读准备',
          attemptId: null,
          validation: null,
        })),
      }
      b.revisions.push(r)
      revisionId = r.id
      return structuredClone(b)
    })
    if (revisionId) this.spawn(this.prepareTargets(result.id, revisionId))
    return result
  }
  private async prepareTargets(batchId: string, revisionId: string): Promise<void> {
    // 每项请求只有一次；响应丢失只观察持久记录，不发起第二次商店检查。
    const original = await this.store.execution(async (_p, _a, _q, _apple, b) =>
      structuredClone(b.find((b) => b.id === batchId)),
    )
    const revision = original?.revisions.find((r) => r.id === revisionId)
    if (!original || !revision) return
    for (const target of revision.targets) {
      if (this.closed) return
      let message = '发布准备未完成，请核对配置后重新准备',
        success = false
      try {
        await this.store.execution(async (_p, _a, _q, _apple, b) => {
          const t = b
            .find((b) => b.id === batchId)
            ?.revisions.find((r) => r.id === revisionId)
            ?.targets.find((t) => t.id === target.id)
          if (t) {
            t.status = 'checking'
            t.message = '正在只读检查账号、目标和安装包'
          }
        })
        await this.preparations.start(
          original.workspaceId,
          original.projectId,
          original.applicationId,
          { ...target.input, requestId: target.preparationId },
        )
        const deadline = Date.now() + 100000
        while (!this.closed && Date.now() < deadline) {
          const result = (
            await this.preparations.list(
              original.workspaceId,
              original.projectId,
              original.applicationId,
            )
          ).find((p) => p.id === target.preparationId)
          if (!result || result.status === 'checking') {
            await delay(250)
            continue
          }
          success = result.status === 'ready'
          message = preparationMessages[result.code]
          break
        }
      } catch (error) {
        if (error instanceof DomainError) message = error.message
      }
      await this.store.execution(async (_p, _a, _q, _apple, b) => {
        const t = b
          .find((b) => b.id === batchId)
          ?.revisions.find((r) => r.id === revisionId)
          ?.targets.find((t) => t.id === target.id)
        if (t) {
          t.status = success ? 'ready' : 'failed'
          t.message = message
        }
      })
    }
    await this.store.execution(async (plans, _a, _q, _apple, b) => {
      const r = b.find((b) => b.id === batchId)?.revisions.find((r) => r.id === revisionId)
      if (r) {
        r.preparedAt = new Date(Math.max(this.now(), Date.parse(r.createdAt))).toISOString()
        r.digest = r.targets.every((t) => t.status === 'ready' && t.planId)
          ? batchDigest(r, plans)
          : null
      }
    })
  }
  /** 一次明确同意整个摘要，原子预约并登记 run；不会提前生成七个活跃尝试。 */
  async confirm(
    w: string,
    p: string,
    a: string,
    id: string,
    rid: string,
    body: unknown,
  ): Promise<ReleaseBatch> {
    if (
      !isRecord(body) ||
      !hasExactKeys(body, ['expectedDigest', 'requestId', 'acknowledged']) ||
      !isPlanId(body.requestId) ||
      body.acknowledged !== true
    )
      throw new DomainError('请核对整份摘要并明确确认本次渠道')
    const requestId = body.requestId
    await this.ready
    let launch = false
    const result = await this.store.execution(async (plans, attempts, q, apple, batches) => {
      const b = batches.find((b) => b.id === id && this.scoped(b, w, p, a)),
        r = b?.revisions.find((r) => r.id === rid)
      // 1. 同一运行重复确认只返回原事实；旧摘要不能复活。
      if (!b || !r) throw new DomainError('批次版本不存在', 404)
      if (!r.digest || body.expectedDigest !== r.digest)
        throw new DomainError('批次摘要不一致或仍有失败项，请重新准备', 409)
      if (r.run) return structuredClone(b)
      if (
        b.revisions.at(-1)?.id !== rid ||
        planFingerprint(b.draft) !== planFingerprint(r.targets.map((t) => t.input))
      )
        throw new DomainError('该摘要已被新草稿或新准备取代，请查看最新版本', 409)
      if (
        this.closed ||
        !r.preparedAt ||
        this.now() >= Date.parse(r.preparedAt) + 300000 ||
        r.targets.some((t) => t.status !== 'ready')
      )
        throw new DomainError('摘要已过期或尚未全部就绪，请重新准备', 409)
      if (
        batches.some(activeBatch) ||
        q.some((q) => q.status === 'checking') ||
        attempts.some((a) => !a.finishedAt) ||
        apple.some((a) => a.status === 'running')
      )
        throw new DomainError('本机已有准备或执行进行中', 409)
      // 2. 在同一事务内检查全部依赖与重复目标，部分失败不偷偷少发。
      for (const t of r.targets) {
        const plan = plans.find((p) => p.id === t.planId)
        if (!plan) throw Error('缺少子计划')
        await this.plans.assertBatchDependencies(plan)
        assertBatchTargetUnblocked(plan, plans, attempts)
      }
      // 3. 固定授权窗口并预约完整顺序，后台只领取一个目标。
      const issuedAt = new Date(this.now()).toISOString()
      r.run = {
        id: randomUUID(),
        requestId,
        consent: {
          id: randomUUID(),
          scope: 'local_batch_once',
          digest: r.digest,
          issuedAt,
          expiresAt: new Date(Date.parse(issuedAt) + 3600000).toISOString(),
        },
        stoppedAt: null,
        finishedAt: null,
      }
      for (const t of r.targets) {
        t.status = 'queued'
        t.message = '等待逐渠道执行；开始前仍会重新复核'
      }
      launch = true
      return structuredClone(b)
    })
    if (launch)
      this.spawn(
        dispatchBatch(
          {
            store: this.store,
            plans: this.plans,
            execution: this.execution,
            now: this.now,
            closed: () => this.closed,
          },
          id,
          rid,
        ),
      )
    return result
  }
  /** 停止和 grant 同队列竞争；已经获得写许可的项继续保留真实结果。 */
  async stop(w: string, p: string, a: string, id: string, runId: string): Promise<ReleaseBatch> {
    await this.ready
    return this.store.execution(async (_p, _a, _q, _apple, batches) => {
      const b = batches.find((b) => b.id === id && this.scoped(b, w, p, a)),
        r = b?.revisions.find((r) => r.run?.id === runId)
      if (!b || !r?.run) throw new DomainError('批次运行不存在', 404)
      if (!r.run.finishedAt && !r.run.stoppedAt) {
        r.run.stoppedAt = new Date(
          Math.max(this.now(), Date.parse(r.run.consent.issuedAt)),
        ).toISOString()
        for (const t of r.targets)
          if (t.status === 'queued') {
            t.status = 'stopped'
            t.message = '已停止，未执行商店操作'
          }
      }
      return structuredClone(b)
    })
  }
  /** 停止本地编排不会撤回远端操作；未完成事实留待重启分类，不自动恢复。 */
  async onModuleDestroy(): Promise<void> {
    this.closed = true
    await this.execution.onModuleDestroy()
    await Promise.allSettled(this.jobs)
  }
}
