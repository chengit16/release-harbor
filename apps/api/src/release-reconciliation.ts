/** @description 本机人工核对用例；仅附加用户声明，不访问商店、不改写原始执行状态或派发任务。 */
import {
  hasExactKeys,
  isRecord,
  type ReleaseAttempt,
  type ReleasePlan,
  type AttemptReconciliation,
} from '@release-harbor/contracts'
import { DomainError } from '@release-harbor/domain'
import { FileReleasePlanStore } from './release-plan-store.ts'

/** 无结论仍阻止整个目标；确认已有草稿后继续阻止相同产物，其他新产物可另行授权。 */
export function attemptBlocksTarget(
  attempt: ReleaseAttempt,
  previous: ReleasePlan,
  next: ReleasePlan,
): boolean {
  if (
    attempt.status !== 'needs_reconciliation' ||
    previous.snapshot.binding.channel !== next.snapshot.binding.channel ||
    previous.snapshot.binding.appId !== next.snapshot.binding.appId
  )
    return false
  if (!attempt.reconciliation) return true
  return (
    attempt.reconciliation.decision === 'draft_present' &&
    previous.snapshot.artifact.sha256 === next.snapshot.artifact.sha256
  )
}
/** 完整范围、摘要和版本都在同队列核对，重复同结论不刷新时间，相反结论不能覆盖。 */
export function reconcileAttempt(
  store: FileReleasePlanStore,
  scope: { workspaceId: string; projectId: string; applicationId: string },
  id: string,
  body: unknown,
  now: number,
): Promise<ReleaseAttempt> {
  if (
    !isRecord(body) ||
    !hasExactKeys(body, [
      'expectedDigest',
      'versionName',
      'buildNumber',
      'decision',
      'acknowledged',
    ]) ||
    body.acknowledged !== true ||
    (body.decision !== 'draft_present' && body.decision !== 'no_draft')
  )
    throw new DomainError('请核对版本、构建号及商店结果，并明确同意本次人工记录')
  const decision: AttemptReconciliation['decision'] = body.decision
  return store.execution(async (plans, attempts) => {
    // 1. 通过父级计划检查归属，不能凭裸回执 ID 读取或修改其他应用。
    const attempt = attempts.find((a) => a.id === id)
    const plan = plans.find(
      (p) =>
        p.id === attempt?.planId &&
        p.snapshot.application.workspaceId === scope.workspaceId &&
        p.snapshot.application.projectId === scope.projectId &&
        p.snapshot.application.id === scope.applicationId,
    )
    if (!attempt || !plan) throw new DomainError('执行记录不存在', 404)
    if (
      body.expectedDigest !== plan.digest ||
      body.versionName !== plan.snapshot.artifact.identity?.versionName ||
      body.buildNumber !== plan.snapshot.artifact.identity?.buildNumber
    )
      throw new DomainError('计划摘要或版本不一致，请重新读取并核对', 409)
    // 2. 只处理未知远端终态；系统成功、未执行或执行中都不能被人工重标为未知结果。
    if (attempt.status !== 'needs_reconciliation' || !attempt.finishedAt)
      throw new DomainError('仅已结束的待核对执行可以记录人工结论', 409)
    if (attempt.reconciliation) {
      if (attempt.reconciliation.decision !== decision)
        throw new DomainError('此记录已有另一核对结论，不能覆盖，请保留历史并人工处理', 409)
      return structuredClone(attempt)
    }
    // 3. 仅附加核对，原始状态、许可和时间不可改动，也不恢复旧授权。
    attempt.reconciliation = {
      decision,
      source: 'local_user',
      checkedAt: new Date(Math.max(now, Date.parse(attempt.finishedAt))).toISOString(),
    }
    return structuredClone(attempt)
  })
}
