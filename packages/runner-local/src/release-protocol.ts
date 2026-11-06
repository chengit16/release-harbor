/** @description 发布执行的私有输入与固定回报；路径只在父子进程传递，不进入公开合同。 */
import { isAbsolute } from 'node:path'
import {
  isBatchConsent,
  isBatchTargetInput,
  isProfileRevision,
  type BatchTargetInput,
  type BatchConsent,
  type BatchTargetValidation,
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
  /** 批次窗口与归属通过私有 stdin 传递，不修改原 frozen 计划。 */
  batch?: BatchExecution
  nonce: string
  attemptId: string
  plan: ReleasePlan
  storageRoot: string
  vaultPath: string
  /** 由宿主生成的 0700 运行目录，Apple 必须提供。 */
  runtimeRoot?: string
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
      ...(Object.hasOwn(value, 'runtimeRoot') ? ['runtimeRoot'] : []),
      ...(Object.hasOwn(value, 'batch') ? ['batch'] : []),
    ]) &&
    (!Object.hasOwn(value, 'runtimeRoot') ||
      (typeof value.runtimeRoot === 'string' && isAbsolute(value.runtimeRoot))) &&
    value.schemaVersion === 1 &&
    typeof value.nonce === 'string' &&
    /^[a-f0-9]{32}$/.test(value.nonce) &&
    isPlanId(value.attemptId) &&
    isReleasePlan(value.plan) &&
    (Object.hasOwn(value, 'batch')
      ? isBatchExecution(value.batch) &&
        value.plan.status === 'frozen' &&
        value.plan.authorization === null &&
        value.plan.snapshot.application.platform === 'android'
      : value.plan.status === 'confirmed') &&
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
      'build_uploaded',
      'build_available',
      'build_processing',
      'draft_saved',
      'review_submitted',
      'oppo_version_processed',
      'vivo_update_accepted',
      'meizu_review_submitted',
      'honor_review_submitted',
      'tencent_review_submitted',
      'harmony_review_submitted',
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
    beforeRemote: (proof?: BatchTargetValidation) => Promise<void>,
    onDiagnostic?: (code: ExecutionDiagnostic) => void,
    batch?: BatchExecution,
  ): Promise<AttemptResult>
  close(): void
}

/** 私有任务关联限定批次；nonce 由进程宿主另行验证。 */
export interface BatchExecution {
  batchId: string
  revisionId: string
  targetId: string
  consent: BatchConsent
  /** 完整、有序摘要允许 worker 独立核对本次目标确实包含在用户同意中。 */
  manifest: {
    id: string
    targets: { id: string; input: BatchTargetInput; planId: string; digest: string }[]
  }
}
/** 准确字段防止批次上下文被误当作任意扩大窗口。 */
export function isBatchExecution(v: unknown): v is BatchExecution {
  return (
    isRecord(v) &&
    hasExactKeys(v, ['batchId', 'revisionId', 'targetId', 'consent', 'manifest']) &&
    [v.batchId, v.revisionId, v.targetId].every(isPlanId) &&
    isBatchConsent(v.consent) &&
    isRecord(v.manifest) &&
    hasExactKeys(v.manifest, ['id', 'targets']) &&
    v.manifest.id === v.revisionId &&
    Array.isArray(v.manifest.targets) &&
    v.manifest.targets.length >= 1 &&
    v.manifest.targets.length <= 7 &&
    v.manifest.targets.every(
      (t) =>
        isRecord(t) &&
        hasExactKeys(t, ['id', 'input', 'planId', 'digest']) &&
        isPlanId(t.id) &&
        isPlanId(t.planId) &&
        isProfileRevision(t.digest) &&
        isBatchTargetInput(t.input),
    ) &&
    new Set(v.manifest.targets.map((t) => t.id)).size === v.manifest.targets.length
  )
}
