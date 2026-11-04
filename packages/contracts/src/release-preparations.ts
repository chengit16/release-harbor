/** @description 发布准备的公开合同；仅持有引用、公开说明和固定状态，不包含秘密或执行路径。 */
import { isRecord } from './applications.ts'
import { hasExactKeys, isPlanId, isReleaseNotes } from './release-plans.ts'
import { isProfileRevision, preflightMessages } from './preflights.ts'

/** 绑定和产物的预期版本来自用户已加载的选项，防止准备时静默换目标。 */
export interface PrepareReleaseInput {
  requestId: string
  bindingId: string
  artifactId: string
  expectedBindingRevision: number
  expectedArtifactSha256: string
  releaseNotes: string
}
/** 准备阶段只产生只读检查和未授权快照，不能据此触发商店写入。 */
export const preparationMessages = {
  ...preflightMessages,
  checking: '正在检查账号、目标和安装包，请稍候',
  ready: '检查通过，请核对发布摘要后确认',
  preparation_interrupted: '发布准备已中断，请在原页重新准备；没有执行商店上传',
  preparation_failed: '发布准备未完成，请核对账号、目标与安装包后重新准备',
  dependency_changed: '准备期间配置、产物或检查结果已变化，请重新准备',
} as const
/** 原始准备事实独立于授权与执行，刷新只读取进度，不重放请求。 */
export interface ReleasePreparation {
  id: string
  workspaceId: string
  projectId: string
  applicationId: string
  input: PrepareReleaseInput
  status: 'checking' | 'ready' | 'failed' | 'interrupted'
  code: keyof typeof preparationMessages
  preflightId: string | null
  planId: string | null
  createdAt: string
  finishedAt: string | null
}
function time(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  )
}
/** 请求与磁盘使用同一精确字段守卫，不接受浏览器声明检查或授权结果。 */
export function isPrepareReleaseInput(value: unknown): value is PrepareReleaseInput {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'requestId',
      'bindingId',
      'artifactId',
      'expectedBindingRevision',
      'expectedArtifactSha256',
      'releaseNotes',
    ]) &&
    isPlanId(value.requestId) &&
    isPlanId(value.bindingId) &&
    isPlanId(value.artifactId) &&
    Number.isSafeInteger(value.expectedBindingRevision) &&
    typeof value.expectedBindingRevision === 'number' &&
    value.expectedBindingRevision > 0 &&
    isProfileRevision(value.expectedArtifactSha256) &&
    isReleaseNotes(value.releaseNotes)
  )
}
/** 准备记录恢复必须满足状态与关联约束，未知字段拒绝读取。 */
export function isReleasePreparation(value: unknown): value is ReleasePreparation {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'id',
      'workspaceId',
      'projectId',
      'applicationId',
      'input',
      'status',
      'code',
      'preflightId',
      'planId',
      'createdAt',
      'finishedAt',
    ]) ||
    !isPlanId(value.id) ||
    value.workspaceId !== 'local' ||
    !isPlanId(value.projectId) ||
    !isPlanId(value.applicationId) ||
    !isPrepareReleaseInput(value.input) ||
    value.id !== value.input.requestId ||
    !time(value.createdAt) ||
    (value.preflightId !== null && !isPlanId(value.preflightId)) ||
    (value.planId !== null && !isPlanId(value.planId))
  )
    return false
  if (
    value.finishedAt !== null &&
    (!time(value.finishedAt) || Date.parse(value.finishedAt) < Date.parse(value.createdAt))
  )
    return false
  if (value.status === 'checking')
    return value.code === 'checking' && value.finishedAt === null && value.planId === null
  if (value.status === 'ready')
    return (
      value.code === 'ready' &&
      value.finishedAt !== null &&
      value.preflightId !== null &&
      value.planId !== null
    )
  return (
    (value.status === 'failed' || value.status === 'interrupted') &&
    value.finishedAt !== null &&
    value.planId === null &&
    typeof value.code === 'string' &&
    Object.hasOwn(preparationMessages, value.code) &&
    !['checking', 'running', 'ready', 'verified'].includes(value.code) &&
    (value.status !== 'interrupted' || value.code === 'preparation_interrupted')
  )
}
