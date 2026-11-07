/** @description 本机人工核对用例；仅附加用户声明，不访问商店、不改写原始执行状态或派发任务。 */
import {
  hasExactKeys,
  isReviewSubmissionAction,
  isRecord,
  type ReleaseAttempt,
  type ReleasePlan,
  type AttemptReconciliation,
} from '@release-harbor/contracts'
import { DomainError } from '@release-harbor/domain'
import { FileReleasePlanStore } from './release-plan-store.ts'

/** 官方版本身份与文件摘要分别保护：重新签名或打包不能成为同一版本的再次提交许可。 */
function sameSubmittedVersion(previous: ReleasePlan, next: ReleasePlan): boolean {
  const p = previous.snapshot,
    n = next.snapshot,
    before = p.artifact.identity,
    after = n.artifact.identity
  if (
    !before ||
    !after ||
    p.application.platform !== n.application.platform ||
    p.application.identifier !== n.application.identifier
  )
    return false
  // 魅族来源仅以版本名核对；Apple 的构建号归属于市场版本，Android／鸿蒙则以递增构建号定位。
  if (p.binding.channel === 'meizu') return before.versionName === after.versionName
  if (p.application.platform === 'ios')
    return before.versionName === after.versionName && before.buildNumber === after.buildNumber
  return /^\d+$/.test(before.buildNumber) && /^\d+$/.test(after.buildNumber)
    ? BigInt(before.buildNumber) === BigInt(after.buildNumber)
    : before.buildNumber === after.buildNumber
}

/** 无结论阻止整个目标；已受理或人工确认存在时阻止同产物或同版本，新版本仍须重新准备。 */
export function attemptBlocksTarget(
  attempt: ReleaseAttempt,
  previous: ReleasePlan,
  next: ReleasePlan,
): boolean {
  if (
    !['needs_reconciliation', 'succeeded'].includes(attempt.status) ||
    previous.snapshot.binding.channel !== next.snapshot.binding.channel ||
    previous.snapshot.binding.appId !== next.snapshot.binding.appId
  )
    return false
  const samePayload =
    previous.snapshot.artifact.sha256 === next.snapshot.artifact.sha256 ||
    sameSubmittedVersion(previous, next)
  if (attempt.status === 'succeeded') return samePayload
  if (!attempt.reconciliation) return true
  return (
    ['draft_present', 'submission_present', 'build_present'].includes(
      attempt.reconciliation.decision,
    ) && samePayload
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
    typeof body.decision !== 'string' ||
    ![
      'draft_present',
      'no_draft',
      'submission_present',
      'not_submitted',
      'build_present',
      'no_build',
    ].includes(body.decision)
  )
    throw new DomainError('请核对版本、构建号及商店结果，并明确同意本次人工记录')
  const decision: AttemptReconciliation['decision'] =
    body.decision === 'build_present'
      ? 'build_present'
      : body.decision === 'no_build'
        ? 'no_build'
        : body.decision === 'draft_present'
          ? 'draft_present'
          : body.decision === 'no_draft'
            ? 'no_draft'
            : body.decision === 'submission_present'
              ? 'submission_present'
              : 'not_submitted'
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
    const allowed =
      plan.snapshot.action === 'apple_upload_build'
        ? ['build_present', 'no_build']
        : isReviewSubmissionAction(plan.snapshot.action)
          ? ['submission_present', 'not_submitted']
          : ['draft_present', 'no_draft']
    if (!allowed.includes(decision)) throw new DomainError('人工核对结论与渠道动作不匹配')
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
