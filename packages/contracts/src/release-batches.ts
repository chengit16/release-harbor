/** @description 同一 Android 应用的批次安全合同；只传公开引用、限定同意和执行事实，不含秘密与本地路径。 */
import { isRecord } from './applications.ts'
import { hasExactKeys, isPlanId } from './release-plans.ts'
import { isProfileRevision } from './preflights.ts'
import { isPrepareReleaseInput, type PrepareReleaseInput } from './release-preparations.ts'

/** 既有 Android 商店；不将鸿蒙或 iOS 隐含纳入批次。 */
export const batchChannels = [
  'huawei',
  'xiaomi',
  'oppo',
  'vivo',
  'meizu',
  'honor',
  'tencent',
] as const
/** UTC 时间用于磁盘与跨端边界，拒绝含糊的本地时区。 */
export function isBatchTime(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  )
}
/** 草稿携带用户看到的预期绑定与字节版本；每个目标请求 ID 在准备时由服务端生成。 */
export type BatchTargetInput = Omit<PrepareReleaseInput, 'requestId' | 'huaweiAction'>
/** 显式选择全部目标及顺序，不在服务端悄悄移除失败项。 */
export interface CreateReleaseBatchInput {
  requestId: string
  targets: BatchTargetInput[]
}
/** 每项目标只执行一次；失败／停止后重新准备形成新 revision。 */
export type BatchTargetStatus =
  | 'pending'
  | 'checking'
  | 'ready'
  | 'failed'
  | 'queued'
  | 'verifying'
  | 'running'
  | 'succeeded'
  | 'needs_reconciliation'
  | 'stopped'
  | 'expired'
  | 'interrupted'
/** 安全复核证明由可信 worker 在真实字节及商店来源核对后产生，不接受浏览器输入。 */
export interface BatchTargetValidation {
  batchId: string
  revisionId: string
  targetId: string
  attemptId: string
  planDigest: string
  checkedAt: string
  profileRevision: string
  artifactSha256: string
  scope: 'artifact_profile_merchant_source'
}
/** 与旧 local_once 分开的批次同意；窗口固定一小时，不能续期。 */
export interface BatchConsent {
  id: string
  scope: 'local_batch_once'
  digest: string
  issuedAt: string
  expiresAt: string
}
/** 一个 revision 最多一个运行，重复请求仅读原事实。 */
export interface BatchRun {
  id: string
  requestId: string
  consent: BatchConsent
  stoppedAt: string | null
  finishedAt: string | null
}
/** 目标保留准备和尝试的独立关联，摘要不使用可变运行状态计算。 */
export interface BatchTarget {
  id: string
  input: BatchTargetInput
  preparationId: string
  planId: string | null
  status: BatchTargetStatus
  message: string
  attemptId: string | null
  validation: BatchTargetValidation | null
}
/** 准备后的输入、目标集合和摘要不可覆盖，运行事实追加在同一文件。 */
export interface BatchRevision {
  id: string
  requestId: string
  createdAt: string
  preparedAt: string | null
  digest: string | null
  targets: BatchTarget[]
  run: BatchRun | null
}
/** 本机草稿和版本历史，editVersion 用于拒绝过时编辑；workspaceId 不是浏览器授权。 */
export interface ReleaseBatch {
  id: string
  requestId: string
  workspaceId: string
  projectId: string
  applicationId: string
  editVersion: number
  draft: BatchTargetInput[]
  createdAt: string
  revisions: BatchRevision[]
}
/** 精确校验公开输入，禁止客户端传来源材料或请求级授权。 */
export function isBatchTargetInput(value: unknown): value is BatchTargetInput {
  return (
    isRecord(value) &&
    !Object.hasOwn(value, 'requestId') &&
    !Object.hasOwn(value, 'xiaomi') &&
    !Object.hasOwn(value, 'huaweiAction') &&
    Object.hasOwn(value, 'releasePolicy') &&
    isPrepareReleaseInput({ ...value, requestId: '00000000-0000-4000-8000-000000000000' })
  )
}
/** 一个应用最多七个不同绑定，重复绑定不因排序而获得第二次授权。 */
export function isBatchTargets(value: unknown): value is BatchTargetInput[] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= 7 &&
    value.every(isBatchTargetInput) &&
    new Set(value.map((t) => t.bindingId)).size === value.length
  )
}
/** 草稿输入只接受请求 ID 和完整目标列表。 */
export function isCreateReleaseBatchInput(value: unknown): value is CreateReleaseBatchInput {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['requestId', 'targets']) &&
    isPlanId(value.requestId) &&
    isBatchTargets(value.targets)
  )
}
/** nonce 在私有协议校验，此处仅验证安全证明字段及范围。 */
export function isBatchTargetValidation(v: unknown): v is BatchTargetValidation {
  return (
    isRecord(v) &&
    hasExactKeys(v, [
      'batchId',
      'revisionId',
      'targetId',
      'attemptId',
      'planDigest',
      'checkedAt',
      'profileRevision',
      'artifactSha256',
      'scope',
    ]) &&
    [v.batchId, v.revisionId, v.targetId, v.attemptId].every(isPlanId) &&
    [v.planDigest, v.profileRevision, v.artifactSha256].every(isProfileRevision) &&
    isBatchTime(v.checkedAt) &&
    v.scope === 'artifact_profile_merchant_source'
  )
}
/** 严格恢复一小时限定确认，不接受无限窗口或未知字段。 */
export function isBatchConsent(v: unknown): v is BatchConsent {
  return (
    isRecord(v) &&
    hasExactKeys(v, ['id', 'scope', 'digest', 'issuedAt', 'expiresAt']) &&
    isPlanId(v.id) &&
    v.scope === 'local_batch_once' &&
    isProfileRevision(v.digest) &&
    isBatchTime(v.issuedAt) &&
    isBatchTime(v.expiresAt) &&
    Date.parse(v.expiresAt) - Date.parse(v.issuedAt) === 3600000
  )
}
function isRun(v: unknown): v is BatchRun {
  const issuedAt = isRecord(v) && isBatchConsent(v.consent) ? v.consent.issuedAt : ''
  return (
    isRecord(v) &&
    hasExactKeys(v, ['id', 'requestId', 'consent', 'stoppedAt', 'finishedAt']) &&
    isPlanId(v.id) &&
    isPlanId(v.requestId) &&
    isBatchConsent(v.consent) &&
    [v.stoppedAt, v.finishedAt].every(
      (t) => t === null || (isBatchTime(t) && Date.parse(t) >= Date.parse(issuedAt)),
    )
  )
}
function isTarget(v: unknown): v is BatchTarget {
  return (
    isRecord(v) &&
    hasExactKeys(v, [
      'id',
      'input',
      'preparationId',
      'planId',
      'status',
      'message',
      'attemptId',
      'validation',
    ]) &&
    isPlanId(v.id) &&
    isBatchTargetInput(v.input) &&
    isPlanId(v.preparationId) &&
    (v.planId === null || isPlanId(v.planId)) &&
    (v.attemptId === null || isPlanId(v.attemptId)) &&
    (v.validation === null || isBatchTargetValidation(v.validation)) &&
    typeof v.message === 'string' &&
    v.message.length <= 300 &&
    !/[\x00-\x1f]/.test(v.message) &&
    typeof v.status === 'string' &&
    [
      'pending',
      'checking',
      'ready',
      'failed',
      'queued',
      'verifying',
      'running',
      'succeeded',
      'needs_reconciliation',
      'stopped',
      'expired',
      'interrupted',
    ].includes(v.status)
  )
}
function isRevision(v: unknown): v is BatchRevision {
  if (
    !isRecord(v) ||
    !hasExactKeys(v, ['id', 'requestId', 'createdAt', 'preparedAt', 'digest', 'targets', 'run']) ||
    !isPlanId(v.id) ||
    !isPlanId(v.requestId) ||
    !isBatchTime(v.createdAt) ||
    !Array.isArray(v.targets) ||
    v.targets.length < 1 ||
    v.targets.length > 7 ||
    !v.targets.every(isTarget) ||
    new Set(v.targets.map((t) => t.id)).size !== v.targets.length ||
    new Set(v.targets.map((t) => t.input.bindingId)).size !== v.targets.length ||
    new Set(v.targets.map((t) => t.preparationId)).size !== v.targets.length
  )
    return false
  if (v.preparedAt === null)
    return (
      v.digest === null &&
      v.run === null &&
      v.targets.every((t) =>
        ['pending', 'checking', 'ready', 'failed', 'interrupted'].includes(t.status),
      )
    )
  return (
    isBatchTime(v.preparedAt) &&
    Date.parse(v.preparedAt) >= Date.parse(v.createdAt) &&
    (v.digest === null || isProfileRevision(v.digest)) &&
    (v.run === null ||
      (isRun(v.run) &&
        v.digest === v.run.consent.digest &&
        Date.parse(v.run.consent.issuedAt) >= Date.parse(v.preparedAt) &&
        Date.parse(v.run.consent.issuedAt) < Date.parse(v.preparedAt) + 300000))
  )
}
/** 字段、归属与唯一性都验证；跨记录关联及不可变规则由同文件存储补充。 */
export function isReleaseBatch(v: unknown): v is ReleaseBatch {
  return (
    isRecord(v) &&
    hasExactKeys(v, [
      'id',
      'requestId',
      'workspaceId',
      'projectId',
      'applicationId',
      'editVersion',
      'draft',
      'createdAt',
      'revisions',
    ]) &&
    isPlanId(v.id) &&
    isPlanId(v.requestId) &&
    v.workspaceId === 'local' &&
    isPlanId(v.projectId) &&
    isPlanId(v.applicationId) &&
    typeof v.editVersion === 'number' &&
    Number.isSafeInteger(v.editVersion) &&
    v.editVersion >= 1 &&
    isBatchTargets(v.draft) &&
    isBatchTime(v.createdAt) &&
    Array.isArray(v.revisions) &&
    v.revisions.every(isRevision) &&
    new Set(v.revisions.map((r) => r.id)).size === v.revisions.length &&
    new Set(v.revisions.map((r) => r.requestId)).size === v.revisions.length
  )
}
