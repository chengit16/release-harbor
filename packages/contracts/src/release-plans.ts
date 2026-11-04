/** @description 不可变发布意图与本地确认的安全合同；授权标识不是执行口令，不含秘密和路径。 */
import { isXiaomiUpdateDetails, type XiaomiUpdateDetails } from './xiaomi-updates.ts'
import {
  isApplication,
  isChannelBinding,
  isRecord,
  type Application,
  type ChannelBinding,
} from './applications.ts'
import { isArtifactRecord, type ArtifactRecord } from './artifacts.ts'
import { isPreflightRecord, isProfileRevision, type PreflightRecord } from './preflights.ts'

/** 首期允许冻结的动作；具体执行能力由执行边界另行限定。 */
export const releaseActions = {
  huawei_save_draft: '华为保存草稿',
  xiaomi_submit_review: '小米提交审核',
  apple_upload_build: 'Apple 上传构建',
} as const
/** 动作与商店必须一一匹配。 */
export type ReleaseAction = keyof typeof releaseActions
/** 冻结输入只引用已保存的预检，requestId 用于响应丢失后的同意图去重。 */
export interface CreateReleasePlan {
  requestId: string
  preflightId: string
  action: ReleaseAction
  /** 1–4000 字符的纯文本，允许换行和制表符。 */
  releaseNotes: string
  /** 小米才允许携带的公开更新资料；历史其他渠道省略，不回填。 */
  xiaomi?: XiaomiUpdateDetails
}
/** 服务端从可信存储取得的完整公开快照，创建后不可变。 */
export interface ReleasePlanSnapshot {
  application: Application
  binding: ChannelBinding
  artifact: ArtifactRecord
  preflight: PreflightRecord
  action: ReleaseAction
  releaseNotes: string
  /** 小米才允许携带的公开更新资料；历史其他渠道省略，不回填。 */
  xiaomi?: XiaomiUpdateDetails
  /** 更新说明 UTF-8 内容的 SHA-256，小写十六进制。 */
  notesDigest: string
  /** 应用、绑定、产物及非秘密目录版本的 SHA-256，不计算秘密指纹。 */
  configDigest: string
}
/** 只授权确定计划在本机执行一次；执行尝试原子关联此授权，不以 ID 充当口令。 */
export interface PlanAuthorization {
  id: string
  planDigest: string
  scope: 'local_once'
  /** ISO 8601 UTC，有效期不超过原预检期限。 */
  issuedAt: string
  expiresAt: string
}
/** 快照与授权同文件原子保存；取消保留历史授权事实但撤销其效力。 */
export interface ReleasePlan {
  id: string
  requestId: string
  snapshot: ReleasePlanSnapshot
  digest: string
  createdAt: string
  status: 'frozen' | 'confirmed' | 'cancelled'
  authorization: PlanAuthorization | null
  cancelledAt: string | null
}
/** 当前失效原因，历史快照与确认事实保留。 */
export const planInvalidationMessages = {
  cancelled: '计划已取消，原确认不可使用',
  binding_changed: '商店绑定已变化，请重新预检并冻结新计划',
  artifact_changed: '安装包记录或实际文件已变化，请重新检查并预检',
  profile_changed: '凭据配置已变化，请重新预检并冻结新计划',
  profile_unavailable: '本机账号材料暂不可用，请到商店账号核对',
  preflight_expired: '原预检已过期，请重新预检并冻结新计划',
  preflight_unavailable: '原预检不可用，请重新预检并冻结新计划',
  authorization_expired: '本次确认已过期，请重新预检并冻结新计划',
} as const
/** current 表示依赖及确认未失效，不能据此直接执行商店操作。 */
export interface ReleasePlanView {
  plan: ReleasePlan
  current: boolean
  invalidatedBy: keyof typeof planInvalidationMessages | null
}

/** 对输入和磁盘记录使用严格键集，避免秘密或未知状态混入安全投影。 */
export function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}
function timestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  )
}
/** 公开 ID 格式，不构成身份或权限证明。 */
export function isPlanId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)
  )
}
/** 仅接受首期动作。 */
export function isReleaseAction(value: unknown): value is ReleaseAction {
  return typeof value === 'string' && Object.hasOwn(releaseActions, value)
}
/** 说明规范化发生在创建边界；磁盘恢复不得偷偷修改原文。 */
export function isReleaseNotes(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim() === value &&
    value.length > 0 &&
    value.length <= 4000 &&
    !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)
  )
}
/** 检查快照归属、平台、摘要与预检关联，领域层另行重算指纹。 */
export function isReleasePlanSnapshot(value: unknown): value is ReleasePlanSnapshot {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'application',
      'binding',
      'artifact',
      'preflight',
      'action',
      'releaseNotes',
      'notesDigest',
      'configDigest',
      ...(Object.hasOwn(value, 'xiaomi') ? ['xiaomi'] : []),
    ]) ||
    !isApplication(value.application) ||
    Object.keys(value.application).length !== 7 ||
    !isChannelBinding(value.binding) ||
    Object.keys(value.binding).length !== 11 ||
    !isArtifactRecord(value.artifact) ||
    Object.keys(value.artifact).length !== 14 ||
    !isPreflightRecord(value.preflight) ||
    !isReleaseAction(value.action) ||
    (value.action === 'xiaomi_submit_review'
      ? !isXiaomiUpdateDetails(value.xiaomi)
      : Object.hasOwn(value, 'xiaomi')) ||
    !isReleaseNotes(value.releaseNotes) ||
    !isProfileRevision(value.notesDigest) ||
    !isProfileRevision(value.configDigest)
  )
    return false
  const { application: a, binding: b, artifact: f, preflight: p } = value
  return (
    p.status === 'passed' &&
    p.checkedAt !== null &&
    p.expiresAt !== null &&
    Date.parse(p.expiresAt) > Date.parse(p.checkedAt) &&
    f.identity !== null &&
    Object.keys(f.identity).length === 6 &&
    f.status === 'ready' &&
    [b, f, p].every(
      (v) =>
        v.workspaceId === a.workspaceId && v.projectId === a.projectId && v.applicationId === a.id,
    ) &&
    b.id === p.bindingId &&
    b.revision === p.bindingRevision &&
    b.credentialReference === p.credentialReference &&
    f.id === p.artifactId &&
    f.sha256 === p.artifactSha256 &&
    f.identity?.packageName === a.identifier &&
    ((a.platform === 'android' &&
      b.channel === 'huawei' &&
      f.format === 'apk' &&
      value.action === 'huawei_save_draft') ||
      (a.platform === 'android' &&
        b.channel === 'xiaomi' &&
        b.appId === a.identifier &&
        f.format === 'apk' &&
        value.action === 'xiaomi_submit_review') ||
      (a.platform === 'ios' &&
        b.channel === 'app_store' &&
        f.format === 'ipa' &&
        value.action === 'apple_upload_build'))
  )
}
/** 所有传输与恢复记录必须满足状态不变量。 */
export function isReleasePlan(value: unknown): value is ReleasePlan {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'id',
      'requestId',
      'snapshot',
      'digest',
      'createdAt',
      'status',
      'authorization',
      'cancelledAt',
    ]) ||
    !isPlanId(value.id) ||
    !isPlanId(value.requestId) ||
    !isReleasePlanSnapshot(value.snapshot) ||
    !isProfileRevision(value.digest) ||
    !timestamp(value.createdAt)
  )
    return false
  const auth = value.authorization
  if (
    auth !== null &&
    (!isRecord(auth) ||
      !hasExactKeys(auth, ['id', 'planDigest', 'scope', 'issuedAt', 'expiresAt']) ||
      !isPlanId(auth.id) ||
      auth.planDigest !== value.digest ||
      auth.scope !== 'local_once' ||
      !timestamp(auth.issuedAt) ||
      !timestamp(auth.expiresAt) ||
      Date.parse(auth.issuedAt) < Date.parse(value.createdAt) ||
      Date.parse(auth.expiresAt) <= Date.parse(auth.issuedAt) ||
      Date.parse(auth.expiresAt) > Date.parse(value.snapshot.preflight.expiresAt ?? '') ||
      Date.parse(auth.expiresAt) - Date.parse(auth.issuedAt) > 300000)
  )
    return false
  return (
    (value.status === 'frozen' && auth === null && value.cancelledAt === null) ||
    (value.status === 'confirmed' && auth !== null && value.cancelledAt === null) ||
    (value.status === 'cancelled' && timestamp(value.cancelledAt))
  )
}
/** 浏览器先校验安全结构，再展示服务端重算的有效性。 */
export function isReleasePlanView(value: unknown): value is ReleasePlanView {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['plan', 'current', 'invalidatedBy']) &&
    isReleasePlan(value.plan) &&
    typeof value.current === 'boolean' &&
    (value.invalidatedBy === null ||
      (typeof value.invalidatedBy === 'string' &&
        Object.hasOwn(planInvalidationMessages, value.invalidatedBy))) &&
    value.current === (value.invalidatedBy === null)
  )
}
