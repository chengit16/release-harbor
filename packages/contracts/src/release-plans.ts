/** @description 不可变发布意图与本地确认的安全合同；授权标识不是执行口令，不含秘密和路径。 */
import {
  isHuaweiUpdateDetails,
  sameHuaweiUpdateDetails,
  type HuaweiUpdateDetails,
} from './huawei-updates.ts'
import {
  sameTencentHarmonySource,
  isTencentUpdateDetails,
  isHarmonyUpdateDetails,
  type TencentUpdateDetails,
  type HarmonyUpdateDetails,
} from './tencent-harmony.ts'
import {
  isMeizuUpdateDetails,
  isHonorUpdateDetails,
  sameMeizuUpdateDetails,
  sameHonorUpdateDetails,
  type MeizuUpdateDetails,
  type HonorUpdateDetails,
} from './store-updates.ts'
import {
  isVivoUpdateDetails,
  isVivoVersionCode,
  sameVivoUpdateDetails,
  type VivoUpdateDetails,
} from './vivo-updates.ts'
import {
  isOppoUpdateDetails,
  sameOppoUpdateDetails,
  type OppoUpdateDetails,
} from './oppo-updates.ts'
import { isReleasePolicy, type ReleasePolicy } from './release-policy.ts'
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
  tencent_submit_review: '应用宝提交审核',
  harmony_submit_review: '鸿蒙提交审核',
  huawei_save_draft: '华为保存草稿',
  huawei_submit_review: '华为提交审核',
  meizu_submit_review: '魅族提交新版本',
  honor_submit_review: '荣耀提交审核',
  vivo_submit_review: 'vivo 提交审核',
  oppo_submit_review: 'OPPO 提交审核',
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
  /** 新界面明确选择的上架意图；历史缺失保持缺失，草稿／上传构建不自动同步商店。 */
  releasePolicy?: ReleasePolicy
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
  /** 新界面明确选择的上架意图；历史缺失保持缺失，草稿／上传构建不自动同步商店。 */
  releasePolicy?: ReleasePolicy
  /** 小米才允许携带的公开更新资料；历史其他渠道省略，不回填。 */
  xiaomi?: XiaomiUpdateDetails
  /** OPPO 自动复用的公开资料，联系人和测试材料不跨执行器边界。 */
  oppo?: OppoUpdateDetails
  /** vivo 只接受来自本次预检的公开来源。 */
  vivo?: VivoUpdateDetails
  /** 新渠道来源只从可信预检取得，不能由浏览器声明。 */
  meizu?: MeizuUpdateDetails
  honor?: HonorUpdateDetails
  /** 新渠道来源仅由可信 worker 生成，不含私人资料。 */
  tencent?: TencentUpdateDetails
  harmony?: HarmonyUpdateDetails
  /** 华为 Android 正式更新的来源、语言及公开资料摘要，仅来自可信预检。 */
  huawei?: HuaweiUpdateDetails
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
  release_time_elapsed: '指定上架时间已到，请选择未来时间并重新准备',
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
      ...(Object.hasOwn(value, 'oppo') ? ['oppo'] : []),
      ...(Object.hasOwn(value, 'vivo') ? ['vivo'] : []),
      ...(Object.hasOwn(value, 'meizu') ? ['meizu'] : []),
      ...(Object.hasOwn(value, 'honor') ? ['honor'] : []),
      ...(Object.hasOwn(value, 'tencent') ? ['tencent'] : []),
      ...(Object.hasOwn(value, 'harmony') ? ['harmony'] : []),
      ...(Object.hasOwn(value, 'huawei') ? ['huawei'] : []),
      ...(Object.hasOwn(value, 'releasePolicy') ? ['releasePolicy'] : []),
    ]) ||
    (Object.hasOwn(value, 'tencent') &&
      (!isTencentUpdateDetails(value.tencent) || value.action !== 'tencent_submit_review')) ||
    (Object.hasOwn(value, 'harmony') &&
      (!isHarmonyUpdateDetails(value.harmony) || value.action !== 'harmony_submit_review')) ||
    !isApplication(value.application) ||
    Object.keys(value.application).length !== 7 ||
    !isChannelBinding(value.binding) ||
    Object.keys(value.binding).length !== 11 ||
    !isArtifactRecord(value.artifact) ||
    Object.keys(value.artifact).length !== 14 ||
    !isPreflightRecord(value.preflight) ||
    !isReleaseAction(value.action) ||
    (Object.hasOwn(value, 'releasePolicy') && !isReleasePolicy(value.releasePolicy)) ||
    (value.action === 'huawei_submit_review'
      ? !isHuaweiUpdateDetails(value.huawei) ||
        !isHuaweiUpdateDetails(value.preflight.huawei) ||
        !sameHuaweiUpdateDetails(value.huawei, value.preflight.huawei) ||
        !isReleasePolicy(value.releasePolicy) ||
        value.releasePolicy.mode === 'manual' ||
        String(value.releaseNotes).length > 1000
      : Object.hasOwn(value, 'huawei')) ||
    (value.action === 'xiaomi_submit_review'
      ? !isXiaomiUpdateDetails(value.xiaomi)
      : Object.hasOwn(value, 'xiaomi')) ||
    (value.action === 'meizu_submit_review'
      ? !isMeizuUpdateDetails(value.meizu) ||
        !isMeizuUpdateDetails(value.preflight.meizu) ||
        !sameMeizuUpdateDetails(value.meizu, value.preflight.meizu) ||
        !isReleasePolicy(value.releasePolicy) ||
        value.releasePolicy.mode !== 'after_approval'
      : Object.hasOwn(value, 'meizu')) ||
    (value.action === 'honor_submit_review'
      ? !isHonorUpdateDetails(value.honor) ||
        !isHonorUpdateDetails(value.preflight.honor) ||
        !sameHonorUpdateDetails(value.honor, value.preflight.honor) ||
        !value.releasePolicy ||
        String(value.releaseNotes).length > 500
      : Object.hasOwn(value, 'honor')) ||
    (value.action === 'vivo_submit_review'
      ? !isVivoUpdateDetails(value.vivo) ||
        !isVivoUpdateDetails(value.preflight.vivo) ||
        !sameVivoUpdateDetails(value.vivo, value.preflight.vivo) ||
        !value.releasePolicy ||
        Array.from(String(value.releaseNotes)).length < 5 ||
        Array.from(String(value.releaseNotes)).length > 200
      : Object.hasOwn(value, 'vivo')) ||
    (value.action === 'oppo_submit_review'
      ? !isOppoUpdateDetails(value.oppo) ||
        !isOppoUpdateDetails(value.preflight.oppo) ||
        !sameOppoUpdateDetails(value.oppo, value.preflight.oppo) ||
        !value.releasePolicy
      : Object.hasOwn(value, 'oppo')) ||
    !isReleaseNotes(value.releaseNotes) ||
    !isProfileRevision(value.notesDigest) ||
    !isProfileRevision(value.configDigest)
  )
    return false
  const { application: a, binding: b, artifact: f, preflight: p } = value
  const oppo = isOppoUpdateDetails(value.oppo) ? value.oppo : null
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
    (value.action !== 'huawei_submit_review' ||
      (isHuaweiUpdateDetails(value.huawei) &&
        /^\d{1,18}$/.test(f.identity.buildNumber) &&
        BigInt(f.identity.buildNumber) > BigInt(value.huawei.sourceVersionCode))) &&
    (value.action !== 'oppo_submit_review' ||
      (oppo !== null &&
        /^\d{1,18}$/.test(f.identity.buildNumber) &&
        BigInt(f.identity.buildNumber) > BigInt(oppo.sourceVersionCode))) &&
    (value.action !== 'vivo_submit_review' ||
      (isVivoUpdateDetails(value.vivo) &&
        isVivoVersionCode(f.identity.buildNumber) &&
        BigInt(f.identity.buildNumber) > BigInt(value.vivo.sourceVersionCode))) &&
    (value.action !== 'meizu_submit_review' ||
      (isMeizuUpdateDetails(value.meizu) &&
        f.identity.versionName !== value.meizu.sourceVersionName)) &&
    (value.action !== 'honor_submit_review' ||
      (isHonorUpdateDetails(value.honor) &&
        /^\d{1,18}$/.test(f.identity.buildNumber) &&
        BigInt(f.identity.buildNumber) > BigInt(value.honor.sourceVersionCode))) &&
    (value.action !== 'tencent_submit_review' ||
      (isTencentUpdateDetails(value.tencent) &&
        isTencentUpdateDetails(p.tencent) &&
        sameTencentHarmonySource(value.tencent, p.tencent) &&
        /^\d{1,18}$/.test(f.identity.buildNumber) &&
        BigInt(f.identity.buildNumber) > BigInt(value.tencent.sourceVersionCode) &&
        isReleasePolicy(value.releasePolicy) &&
        value.releasePolicy.mode !== 'manual')) &&
    (value.action !== 'harmony_submit_review' ||
      (isHarmonyUpdateDetails(value.harmony) &&
        isHarmonyUpdateDetails(p.harmony) &&
        sameTencentHarmonySource(value.harmony, p.harmony) &&
        /^\d{1,18}$/.test(f.identity.buildNumber) &&
        BigInt(f.identity.buildNumber) > BigInt(value.harmony.sourceVersionCode) &&
        isReleasePolicy(value.releasePolicy) &&
        value.releasePolicy.mode !== 'manual')) &&
    ((a.platform === 'android' &&
      b.channel === 'tencent' &&
      f.format === 'apk' &&
      value.action === 'tencent_submit_review') ||
      (a.platform === 'harmony' &&
        b.channel === 'harmony' &&
        f.format === 'app' &&
        value.action === 'harmony_submit_review') ||
      (a.platform === 'android' &&
        b.channel === 'huawei' &&
        f.format === 'apk' &&
        (value.action === 'huawei_save_draft' || value.action === 'huawei_submit_review')) ||
      (a.platform === 'android' &&
        b.channel === 'xiaomi' &&
        b.appId === a.identifier &&
        f.format === 'apk' &&
        value.action === 'xiaomi_submit_review') ||
      (a.platform === 'android' &&
        b.channel === 'oppo' &&
        b.appId === a.identifier &&
        f.format === 'apk' &&
        value.action === 'oppo_submit_review') ||
      (a.platform === 'android' &&
        b.channel === 'vivo' &&
        b.appId === a.identifier &&
        f.format === 'apk' &&
        value.action === 'vivo_submit_review') ||
      (a.platform === 'android' &&
        b.channel === 'meizu' &&
        f.format === 'apk' &&
        value.action === 'meizu_submit_review') ||
      (a.platform === 'android' &&
        b.channel === 'honor' &&
        f.format === 'apk' &&
        value.action === 'honor_submit_review') ||
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

/** 送审动作使用提交结论，不能套用华为草稿语义。 */
export function isReviewSubmissionAction(action: ReleaseAction): boolean {
  return (
    action === 'huawei_submit_review' ||
    action === 'tencent_submit_review' ||
    action === 'harmony_submit_review' ||
    action === 'meizu_submit_review' ||
    action === 'honor_submit_review' ||
    action === 'vivo_submit_review' ||
    action === 'xiaomi_submit_review' ||
    action === 'oppo_submit_review'
  )
}
