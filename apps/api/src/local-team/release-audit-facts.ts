/** @description 从发布存储的不可变事实生成审计证据；只比较本机记录，不读取文件或请求商店。 */
import type {
  ReleasePlan,
  ReleaseAttempt,
  ReleaseBatch,
  AppleReviewRecord,
  TeamAuditEvent,
  TeamAuditTarget,
} from '@release-harbor/contracts'
import { planFingerprint } from '@release-harbor/domain'

/** 既有业务聚合的只读视图，不增加快照字段或迁移旧摘要。 */
export interface ReleaseAuditState {
  /** 已经与业务事实一起提交的事件凭证。 */
  auditLinks?: { id: string; evidence: string }[]
  plans: ReleasePlan[]
  attempts: ReleaseAttempt[]
  batches: ReleaseBatch[]
  appleReviews: AppleReviewRecord[]
}
/** 指纹只覆盖不可变阶段事实；终态回执另行投影，不能改变原操作者。 */
export interface ReleaseAuditFact {
  at: string
  action: TeamAuditEvent['action']
  target: TeamAuditTarget
  evidence: string
  outcome: TeamAuditEvent['outcome']
}
/** 准备、确认、尝试、写许可及核对均有独立证据；缺少旧身份不进行回填。
 * 长函数保留原因：同一安全证据映射集中列出各聚合的不可变字段，避免分散规则误把终态变化当成新操作者。 */
export function releaseAuditFacts(state: ReleaseAuditState): ReleaseAuditFact[] {
  const facts: ReleaseAuditFact[] = []
  function add(
    target: TeamAuditTarget,
    action: TeamAuditEvent['action'],
    at: string,
    proof: unknown,
    outcome: TeamAuditEvent['outcome'] = null,
  ): void {
    facts.push({
      target,
      action,
      at,
      evidence: planFingerprint({ target, action, at, proof }),
      outcome,
    })
  }
  // 1. 单计划和批次子计划都保留原始摘要，授权和尝试使用各自的独立 ID。
  for (const plan of state.plans) {
    const a = plan.snapshot.application
    const target: TeamAuditTarget = {
      kind: 'plan',
      projectId: a.projectId,
      applicationId: a.id,
      recordId: plan.id,
      referenceId: plan.id,
    }
    const attempt = state.attempts.find((a) => a.planId === plan.id)
    const outcome = attempt ? result(attempt) : null
    add(target, 'release_prepare', plan.createdAt, plan.digest)
    if (plan.authorization)
      add(
        { ...target, referenceId: plan.authorization.id },
        'release_confirm',
        plan.authorization.issuedAt,
        plan.authorization,
        outcome,
      )
    if (attempt) {
      const link = { ...target, referenceId: attempt.id }
      add(
        link,
        'release_execute',
        attempt.createdAt,
        [plan.digest, attempt.authorizationId, attempt.origin ?? null],
        outcome,
      )
      if (attempt.remoteStartedAt)
        add(
          link,
          'release_permit',
          attempt.remoteStartedAt,
          [plan.digest, attempt.authorizationId, attempt.origin ?? null],
          outcome,
        )
      if (attempt.reconciliation)
        add(
          link,
          'release_reconcile',
          attempt.reconciliation.checkedAt,
          [plan.digest, attempt.reconciliation],
          outcome,
        )
    }
  }
  // 2. 版本与运行分开关联；批次的子尝试仍使用计划证据，页面可逐项核对。
  for (const batch of state.batches)
    for (const r of batch.revisions) {
      const target: TeamAuditTarget = {
        kind: 'batch',
        projectId: batch.projectId,
        applicationId: batch.applicationId,
        recordId: batch.id,
        referenceId: r.id,
      }
      add(target, 'release_prepare', r.createdAt, [
        r.requestId,
        r.targets.map((t) => [t.id, t.input, t.preparationId]),
      ])
      if (r.run)
        add({ ...target, referenceId: r.run.id }, 'release_confirm', r.run.consent.issuedAt, [
          r.digest,
          r.run.id,
          r.run.requestId,
          r.run.consent,
        ])
    }
  // 3. Apple 已有构建没有独立 attempt，使用原意图 ID 关联消费、许可及回执。
  for (const r of state.appleReviews) {
    const b = r.snapshot.binding
    const target: TeamAuditTarget = {
      kind: 'apple',
      projectId: b.projectId,
      applicationId: b.applicationId,
      recordId: r.id,
      referenceId: r.id,
    }
    add(target, 'release_prepare', r.createdAt, r.digest)
    if (r.consumedAt) add(target, 'release_confirm', r.consumedAt, r.digest, result(r))
    if (r.remoteStartedAt) add(target, 'release_permit', r.remoteStartedAt, r.digest, result(r))
    if (r.reconciliation)
      add(
        target,
        'release_reconcile',
        r.reconciliation.checkedAt,
        [r.digest, r.reconciliation],
        result(r),
      )
  }
  return facts
}
function result(r: ReleaseAttempt | AppleReviewRecord): NonNullable<TeamAuditEvent['outcome']> {
  return { id: r.id, status: r.status, code: r.code, finishedAt: r.finishedAt }
}
