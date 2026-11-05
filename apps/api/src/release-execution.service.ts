/** @description 本机执行协调：原子消费确认，持久化远端许可及安全结果；API 不加载 SDK 或秘密。 */
import { randomUUID } from 'node:crypto'
import { isRemoteExecutionDiagnostic } from '@release-harbor/contracts'
import type {
  ReleaseAttempt,
  ReleasePlan,
  AttemptResult,
  ExecutionDiagnostic,
} from '@release-harbor/contracts'
import { DomainError, validatePlanDecision } from '@release-harbor/domain'
import type { ReleaseExecutor } from '@release-harbor/runner-local'
import { FileReleasePlanStore } from './release-plan-store.ts'
import { attemptBlocksTarget, reconcileAttempt } from './release-reconciliation.ts'
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
            diagnostic: 'runner_interrupted',
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
  /** 同计划重复请求返回原尝试；confirm=true 时同事务产生并消费限定确认，提交后才启动 worker。 */
  async start(
    workspaceId: string,
    projectId: string,
    applicationId: string,
    id: string,
    body: unknown,
    confirm = false,
  ): Promise<ReleaseAttempt> {
    const digest = validatePlanDecision(body, true)
    await this.ready
    let launch: ReleasePlan | null = null
    // 1. 以同一队列核对范围、依赖与单槽，再将消费事实和尝试一次提交。
    const attempt = await this.store.execution(async (plans, attempts) => {
      const original = plans.find(
        (p) =>
          p.id === id &&
          p.snapshot.application.workspaceId === workspaceId &&
          p.snapshot.application.projectId === projectId &&
          p.snapshot.application.id === applicationId,
      )
      if (!original) throw new DomainError('发布计划不存在', 404)
      let plan = original
      if (plan.digest !== digest) throw new DomainError('计划摘要不一致，请重新读取', 409)
      const previous = attempts.find((a) => a.planId === id)
      if (previous) return structuredClone(previous)
      if (this.closed) throw new DomainError('执行器正在停止', 503)
      if (plan.snapshot.action === 'xiaomi_submit_review' && !plan.snapshot.releasePolicy)
        throw new DomainError('旧计划未记录上架类型，请重新准备并明确选择', 409)
      if (
        ![
          'huawei_save_draft',
          'xiaomi_submit_review',
          'oppo_submit_review',
          'vivo_submit_review',
          'meizu_submit_review',
          'honor_submit_review',
        ].includes(plan.snapshot.action)
      )
        throw new DomainError(
          '当前 SDK 尚不能使用已配置的 Apple API Key 上传构建，确认已保留，请等待上传适配完善',
          409,
        )
      if (attempts.some((a) => a.finishedAt === null))
        throw new DomainError('本机已有执行进行中，请等待回执', 409)
      // 未知结果须先记录明确人工结论；新计划也不能绕过同一产物的重复上传保护。
      if (
        attempts.some((a) =>
          plans.some((p) => p.id === a.planId && attemptBlocksTarget(a, p, plan)),
        )
      )
        throw new DomainError(
          '此商店目标有未处理的待核对执行，或该产物已确认受理；请查看执行详情',
          409,
        )
      if (confirm) plan = await this.plans.authorize(plan)
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
      plans[plans.indexOf(original)] = plan
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
  /** 人工结论写入前先等待启动恢复，来源保护由 HTTP 边界执行。 */
  async reconcile(
    workspaceId: string,
    projectId: string,
    applicationId: string,
    id: string,
    body: unknown,
  ): Promise<ReleaseAttempt> {
    await this.ready
    return reconcileAttempt(
      this.store,
      { workspaceId, projectId, applicationId },
      id,
      body,
      this.now(),
    )
  }
  private async run(plan: ReleasePlan, attemptId: string): Promise<void> {
    let outcome: AttemptResult = 'interrupted'
    let diagnostic: ExecutionDiagnostic = 'runner_interrupted'
    try {
      outcome = await this.executor.run(
        plan,
        attemptId,
        async () => {
          // 3. 远端许可须先持久化。若写入或依赖核对失败，不向 worker 授予许可。
          await this.store.execution(async (_plans, attempts) => {
            const a = attempts.find((v) => v.id === attemptId)
            if (this.closed || !a || a.status !== 'preparing') throw new Error('执行已关闭')
            try {
              await this.plans.assertExecutable(plan)
            } catch (error) {
              diagnostic = 'authorization_changed'
              throw error
            }
            a.status = 'running'
            a.code = 'running'
            a.remoteStartedAt = new Date(this.now()).toISOString()
          })
          // 许可前的阶段已结束；后续没有具体回报时保持“结果不明”，不能沿用材料错误。
          diagnostic = 'remote_unknown'
        },
        (code) => {
          diagnostic = code
        },
      )
    } catch {
      /* 私有异常不可投影到回执，结果由持久化许可决定。 */
    }
    try {
      await this.store.execution(async (_plans, attempts) => {
        const a = attempts.find((v) => v.id === attemptId)
        if (!a || a.finishedAt !== null) return
        // 4. 无许可的成功回报视为协议失败；许可后的任意失败都保守标为待核对。
        const code = a.remoteStartedAt
          ? outcome ===
            (plan.snapshot.action === 'meizu_submit_review'
              ? 'meizu_review_submitted'
              : plan.snapshot.action === 'honor_submit_review'
                ? 'honor_review_submitted'
                : plan.snapshot.action === 'vivo_submit_review'
                  ? 'vivo_update_accepted'
                  : plan.snapshot.action === 'oppo_submit_review'
                    ? 'oppo_version_processed'
                    : plan.snapshot.action === 'xiaomi_submit_review'
                      ? 'review_submitted'
                      : 'draft_saved')
            ? outcome
            : 'needs_reconciliation'
          : outcome === 'verification_failed'
            ? 'verification_failed'
            : 'interrupted'
        if (
          code !== 'draft_saved' &&
          code !== 'review_submitted' &&
          code !== 'oppo_version_processed' &&
          code !== 'vivo_update_accepted' &&
          code !== 'meizu_review_submitted' &&
          code !== 'honor_review_submitted'
        )
          // 许可事实决定终态，具体安全诊断仍可保留；许可前阶段不能冒充上传失败原因。
          a.diagnostic =
            a.remoteStartedAt && !isRemoteExecutionDiagnostic(diagnostic)
              ? 'remote_unknown'
              : diagnostic
        a.code = code
        a.status =
          code === 'draft_saved' ||
          code === 'review_submitted' ||
          code === 'oppo_version_processed' ||
          code === 'vivo_update_accepted' ||
          code === 'meizu_review_submitted' ||
          code === 'honor_review_submitted'
            ? 'succeeded'
            : code === 'verification_failed'
              ? 'failed'
              : code
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
