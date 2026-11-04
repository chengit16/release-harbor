/** @description 发布执行的私有输入与固定回报；路径只在父子进程传递，不进入公开合同。 */
import { isAbsolute } from 'node:path'
import {
  hasExactKeys,
  isRecord,
  isReleasePlan,
  isPlanId,
  type ReleasePlan,
  type AttemptResult,
  type ExecutionDiagnostic,
} from '@release-harbor/contracts'

/** 本机宿主固定目录；nonce 只关联一次 worker，不替代产品授权。 */
export interface ReleaseTask {
  schemaVersion: 1
  nonce: string
  attemptId: string
  plan: ReleasePlan
  storageRoot: string
  vaultPath: string
}
/** worker 只接受完整、已确认计划与受控启动目录。 */
export function isReleaseTask(value: unknown): value is ReleaseTask {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'schemaVersion',
      'nonce',
      'attemptId',
      'plan',
      'storageRoot',
      'vaultPath',
    ]) &&
    value.schemaVersion === 1 &&
    typeof value.nonce === 'string' &&
    /^[a-f0-9]{32}$/.test(value.nonce) &&
    isPlanId(value.attemptId) &&
    isReleasePlan(value.plan) &&
    value.plan.status === 'confirmed' &&
    [value.storageRoot, value.vaultPath].every(
      (p) => typeof p === 'string' && isAbsolute(p) && !/[\x00-\x1f]/.test(p),
    )
  )
}
/** 所有 SDK 失败原文在 worker 内丢弃；执行后只返回固定结果。 */
export function isAttemptResult(value: unknown): value is AttemptResult {
  return (
    typeof value === 'string' &&
    [
      'draft_saved',
      'review_submitted',
      'oppo_version_processed',
      'vivo_update_accepted',
      'verification_failed',
      'interrupted',
      'needs_reconciliation',
    ].includes(value)
  )
}
/** 测试注入端口不请求商店；真实实现隔离到固定进程。 */
export interface ReleaseExecutor {
  run(
    plan: ReleasePlan,
    attemptId: string,
    beforeRemote: () => Promise<void>,
    onDiagnostic?: (code: ExecutionDiagnostic) => void,
  ): Promise<AttemptResult>
  close(): void
}
