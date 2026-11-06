/** @description 批次串行派发与写许可；共用执行槽和安全回执，落盘失败立即停止，不自动重放。 */
import { randomUUID } from 'node:crypto'
import {
  isBatchTargetValidation,
  type ReleaseBatch,
  type ReleasePlan,
  type ReleaseAttempt,
  type BatchTargetValidation,
} from '@release-harbor/contracts'
import { DomainError } from '@release-harbor/domain'
import type { FileReleasePlanStore } from './release-plan-store.ts'
import type { ReleasePlansService } from './release-plans.service.ts'
import type { ReleaseExecutionService } from './release-execution.service.ts'
import { attemptBlocksTarget } from './release-reconciliation.ts'

/** 依赖只来自本机装配，不接受浏览器的执行器或时钟。 */
export interface BatchDispatchPorts {
  store: FileReleasePlanStore
  plans: ReleasePlansService
  execution: ReleaseExecutionService
  now: () => number
  closed: () => boolean
}
/** 确认前和每次领取时复用历史目标保护，新 revision 不构成重复提交的通行证。 */
export function assertBatchTargetUnblocked(
  plan: ReleasePlan,
  plans: ReleasePlan[],
  attempts: ReleaseAttempt[],
): void {
  if (attempts.some((a) => plans.some((p) => p.id === a.planId && attemptBlocksTarget(a, p, plan))))
    throw new DomainError('此商店目标有待核对执行，或该产物已确认受理，请先处理执行记录', 409)
}
/** 首版一次只领取一项；只有终态已成功落盘，才会继续其他独立渠道。 */
export async function dispatchBatch(
  ports: BatchDispatchPorts,
  batchId: string,
  revisionId: string,
): Promise<void> {
  const { store, plans, execution, now } = ports
  while (!ports.closed()) {
    // 1. 领取和槽占用同事务；排队记录不是正在执行的 attempt。
    const next = await store.execution(async (saved, attempts, _q, apple, batches) => {
      const b = batches.find((b) => b.id === batchId),
        r = b?.revisions.find((r) => r.id === revisionId)
      if (!b || !r?.run || r.run.finishedAt) return null
      const run = r.run
      if (run.stoppedAt || now() >= Date.parse(run.consent.expiresAt)) {
        for (const t of r.targets)
          if (t.status === 'queued') {
            t.status = run.stoppedAt ? 'stopped' : 'expired'
            t.message = run.stoppedAt
              ? '已停止，未执行商店操作'
              : '批次开始写入窗口已过，请重新准备剩余项'
          }
      }
      if (attempts.some((a) => a.finishedAt === null) || apple.some((a) => a.status === 'running'))
        throw Error('执行槽冲突')
      const t = r.targets.find((t) => t.status === 'queued')
      if (!t) {
        run.finishedAt = new Date(Math.max(now(), Date.parse(run.consent.issuedAt))).toISOString()
        return null
      }
      const plan = saved.find((p) => p.id === t.planId)
      if (!plan) throw Error('缺少批次子计划')
      try {
        await plans.assertBatchDependencies(plan)
        assertBatchTargetUnblocked(plan, saved, attempts)
      } catch (error) {
        t.status = 'failed'
        t.message = error instanceof DomainError ? error.message : '临执行依赖无法核对，请重新准备'
        return { skipped: true as const }
      }
      const a: ReleaseAttempt = {
        id: randomUUID(),
        planId: plan.id,
        planDigest: plan.digest,
        authorizationId: run.consent.id,
        status: 'preparing',
        code: 'preparing',
        createdAt: new Date(now()).toISOString(),
        remoteStartedAt: null,
        finishedAt: null,
        origin: { batchId: b.id, revisionId: r.id, targetId: t.id },
      }
      attempts.push(a)
      t.attemptId = a.id
      t.status = 'verifying'
      t.message = '正在独立复核安装包、账号与商店来源'
      return {
        skipped: false as const,
        plan: structuredClone(plan),
        attemptId: a.id,
        targetId: t.id,
        context: {
          batchId: b.id,
          revisionId: r.id,
          targetId: t.id,
          consent: structuredClone(run.consent),
          manifest: {
            id: r.id,
            targets: r.targets.map((item) => {
              const child = saved.find((p) => p.id === item.planId)
              if (!child) throw Error('缺少批次摘要计划')
              return {
                id: item.id,
                input: structuredClone(item.input),
                planId: child.id,
                digest: child.digest,
              }
            }),
          },
        },
      }
    })
    if (!next) return
    if (next.skipped) continue
    // 2. 子进程提供证明；控制面再次检查冻结依赖和固定窗口后，先持久化再 grant。
    await execution.runBatchTarget(
      next.plan,
      next.attemptId,
      next.context,
      async (proof?: BatchTargetValidation) => {
        if (!isBatchTargetValidation(proof)) throw Error('缺少可信复核证明')
        await store.execution(async (saved, attempts, _q, _apple, batches) => {
          const b = batches.find((b) => b.id === batchId),
            r = b?.revisions.find((r) => r.id === revisionId),
            t = r?.targets.find((t) => t.id === next.targetId),
            a = attempts.find((a) => a.id === next.attemptId)
          const time = now()
          if (
            ports.closed() ||
            !r?.run ||
            r.run.stoppedAt ||
            r.run.finishedAt ||
            !t ||
            t.status !== 'verifying' ||
            !a ||
            a.status !== 'preparing' ||
            time >= Date.parse(r.run.consent.expiresAt) ||
            proof.batchId !== batchId ||
            proof.revisionId !== revisionId ||
            proof.targetId !== t.id ||
            proof.attemptId !== a.id ||
            proof.planDigest !== next.plan.digest ||
            proof.profileRevision !== next.plan.snapshot.preflight.profileRevision ||
            proof.artifactSha256 !== next.plan.snapshot.artifact.sha256 ||
            Date.parse(proof.checkedAt) > time ||
            time - Date.parse(proof.checkedAt) > 300000 ||
            Date.parse(proof.checkedAt) < Date.parse(a.createdAt)
          )
            throw Error('批次许可已失效')
          await plans.assertBatchDependencies(next.plan)
          assertBatchTargetUnblocked(
            next.plan,
            saved,
            attempts.filter((v) => v.id !== a.id),
          )
          t.validation = proof
          t.status = 'running'
          t.message = '正在执行已确认的商店操作'
          a.status = 'running'
          a.code = 'running'
          a.remoteStartedAt = new Date(time).toISOString()
        })
      },
    )
    // 3. 许可后未知只阻塞该商店，其他独立项可以继续；不能把未落盘状态当完成。
    await store.execution(async (_saved, attempts, _q, _apple, batches) => {
      const r = batches.find((b) => b.id === batchId)?.revisions.find((r) => r.id === revisionId),
        t = r?.targets.find((t) => t.id === next.targetId),
        a = attempts.find((a) => a.id === next.attemptId)
      if (!t || !a?.finishedAt) throw Error('执行结果尚未落盘')
      t.status =
        a.status === 'succeeded'
          ? 'succeeded'
          : a.status === 'needs_reconciliation'
            ? 'needs_reconciliation'
            : r?.run?.stoppedAt
              ? 'stopped'
              : a.status === 'failed'
                ? 'failed'
                : 'interrupted'
      t.message =
        a.status === 'succeeded'
          ? '操作已完成，审核及上架以商店为准'
          : a.status === 'needs_reconciliation'
            ? '远端结果待核对，系统不会自动重试'
            : r?.run?.stoppedAt
              ? '已停止，未获写许可'
              : '执行前未通过或中断，请核对详情后重新准备'
    })
  }
}

/** 启动后仅分类已有事实；不续跑旧队列或复活消费。须在执行服务恢复之后调用。 */
export function recoverBatches(
  batches: ReleaseBatch[],
  attempts: ReleaseAttempt[],
  now: number,
): void {
  for (const b of batches)
    for (const r of b.revisions) {
      if (r.preparedAt === null) {
        for (const t of r.targets)
          if (['pending', 'checking'].includes(t.status)) {
            t.status = 'interrupted'
            t.message = '准备因服务重启中断，请重新准备'
          }
        r.preparedAt = new Date(Math.max(now, Date.parse(r.createdAt))).toISOString()
      }
      if (r.run && !r.run.finishedAt) {
        for (const t of r.targets) {
          if (!['verifying', 'running', 'queued'].includes(t.status)) continue
          const a = attempts.find((a) => a.id === t.attemptId)
          if (a) {
            t.status =
              a.status === 'succeeded'
                ? 'succeeded'
                : a.remoteStartedAt
                  ? 'needs_reconciliation'
                  : 'interrupted'
            t.message = a.remoteStartedAt ? '请核对商店中的实际结果' : '服务重启，未获远端写许可'
          } else if (t.status === 'queued') {
            t.status = 'interrupted'
            t.message = '服务重启，未执行；请重新准备剩余项'
          }
        }
        r.run.finishedAt = new Date(Math.max(now, Date.parse(r.run.consent.issuedAt))).toISOString()
      }
    }
}
