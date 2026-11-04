/** @description 本机执行协调：原子消费确认，持久化远端许可及安全结果；API 不加载 SDK 或秘密。 */
import { randomUUID } from 'node:crypto'
import type { ReleaseAttempt, ReleasePlan, AttemptResult } from '@release-harbor/contracts'
import { DomainError, validatePlanDecision } from '@release-harbor/domain'
import type { ReleaseExecutor } from '@release-harbor/runner-local'
import { FileReleasePlanStore } from './release-plan-store.ts'
import { ReleasePlansService } from './release-plans.service.ts'

/** 一个服务实例独占一个存储；启动恢复不重放，终态不能再派发。 */
export class ReleaseExecutionService {
  private readonly ready: Promise<unknown>
  private readonly jobs = new Set<Promise<void>>()
  private closed = false
  constructor(
    private readonly store: FileReleasePlanStore,
    private readonly plans: ReleasePlansService,
    private readonly executor: ReleaseExecutor,
    private readonly now: () => number = Date.now,
  ) {
    this.ready = store.execution(async (_plans, attempts) => {
      for (const a of attempts)
        if (a.finishedAt === null)
          Object.assign(a, {
            status: a.remoteStartedAt ? 'needs_reconciliation' : 'interrupted',
            code: a.remoteStartedAt ? 'needs_reconciliation' : 'interrupted',
            finishedAt: new Date(
              Math.max(this.now(), Date.parse(a.remoteStartedAt ?? a.createdAt)),
            ).toISOString(),
          })
    })
    // 保留失败供调用方报告；避免启动时未被查询的拒绝成为未处理异常。
    void this.ready.catch(() => undefined)
  }
  /** 仅查询持久化事实，刷新不会派发任务或查询远端。 */
  async list(
    workspaceId: string,
    projectId: string,
    applicationId: string,
  ): Promise<ReleaseAttempt[]> {
    await this.ready
    return this.store.attempts(workspaceId, projectId, applicationId)
  }
  /** 同计划重复请求返回原尝试；原子提交成功后才启动 worker，响应丢失不重试写操作。 */
  async start(
    workspaceId: string,
    projectId: string,
    applicationId: string,
    id: string,
    body: unknown,
  ): Promise<ReleaseAttempt> {
    const digest = validatePlanDecision(body, true)
    await this.ready
    let launch: ReleasePlan | null = null
    // 1. 以同一队列核对范围、依赖与单槽，再将消费事实和尝试一次提交。
    const attempt = await this.store.execution(async (plans, attempts) => {
      const plan = plans.find(
        (p) =>
          p.id === id &&
          p.snapshot.application.workspaceId === workspaceId &&
          p.snapshot.application.projectId === projectId &&
          p.snapshot.application.id === applicationId,
      )
      if (!plan) throw new DomainError('发布计划不存在', 404)
      if (plan.digest !== digest) throw new DomainError('计划摘要不一致，请重新读取', 409)
      const previous = attempts.find((a) => a.planId === id)
      if (previous) return structuredClone(previous)
      if (this.closed) throw new DomainError('执行器正在停止', 503)
      if (plan.snapshot.action !== 'huawei_save_draft')
        throw new DomainError(
          '当前 SDK 尚不能使用已配置的 Apple API Key 上传构建，确认已保留，请等待上传适配完善',
          409,
        )
      if (attempts.some((a) => a.finishedAt === null))
        throw new DomainError('本机已有执行进行中，请等待回执', 409)
      // 未知远端结果不能通过冻结新计划绕过，须先提供后续人工核对流程。
      if (
        attempts.some(
          (a) =>
            a.status === 'needs_reconciliation' &&
            plans.some(
              (p) =>
                p.id === a.planId &&
                p.snapshot.binding.channel === plan.snapshot.binding.channel &&
                p.snapshot.binding.appId === plan.snapshot.binding.appId,
            ),
        )
      )
        throw new DomainError(
          '此商店目标存在待核对执行，请先到商店后台核对；当前不允许再次上传',
          409,
        )
      await this.plans.assertExecutable(plan)
      const authorization = plan.authorization
      if (!authorization) throw new DomainError('缺少计划确认', 409)
      const result: ReleaseAttempt = {
        id: randomUUID(),
        planId: plan.id,
        authorizationId: authorization.id,
        planDigest: plan.digest,
        status: 'preparing',
        code: 'preparing',
        createdAt: new Date(this.now()).toISOString(),
        remoteStartedAt: null,
        finishedAt: null,
      }
      attempts.push(result)
      launch = structuredClone(plan)
      return structuredClone(result)
    })
    // 2. 任务不绑定浏览器连接；刷新只读回执，API 请求无需等待上传。
    if (launch) {
      const job = this.run(launch, attempt.id)
      this.jobs.add(job)
      void job.finally(() => this.jobs.delete(job))
    }
    return attempt
  }
  private async run(plan: ReleasePlan, attemptId: string): Promise<void> {
    let outcome: AttemptResult = 'interrupted'
    try {
      outcome = await this.executor.run(plan, attemptId, async () => {
        // 3. 远端许可须先持久化。若写入或依赖核对失败，不向 worker 授予许可。
        await this.store.execution(async (_plans, attempts) => {
          const a = attempts.find((v) => v.id === attemptId)
          if (this.closed || !a || a.status !== 'preparing') throw new Error('执行已关闭')
          await this.plans.assertExecutable(plan)
          a.status = 'running'
          a.code = 'running'
          a.remoteStartedAt = new Date(this.now()).toISOString()
        })
      })
    } catch {
      /* 私有异常不可投影到回执，结果由持久化许可决定。 */
    }
    try {
      await this.store.execution(async (_plans, attempts) => {
        const a = attempts.find((v) => v.id === attemptId)
        if (!a || a.finishedAt !== null) return
        // 4. 无许可的成功回报视为协议失败；许可后的任意失败都保守标为待核对。
        const code = a.remoteStartedAt
          ? outcome === 'draft_saved'
            ? 'draft_saved'
            : 'needs_reconciliation'
          : outcome === 'verification_failed'
            ? 'verification_failed'
            : 'interrupted'
        a.code = code
        a.status =
          code === 'draft_saved' ? 'succeeded' : code === 'verification_failed' ? 'failed' : code
        a.finishedAt = new Date(
          Math.max(this.now(), Date.parse(a.remoteStartedAt ?? a.createdAt)),
        ).toISOString()
      })
    } catch {
      /* 存储不明保留进行中记录，下次启动仅恢复为中断或待核对。 */
    }
  }
  /** 关闭时终止等待及 worker，保留远端事实边界；不声称撤回商店操作。 */
  async onModuleDestroy(): Promise<void> {
    this.closed = true
    this.executor.close()
    await Promise.allSettled(this.jobs)
  }
}
