/** @description 凭据目录与只读预检公开合同，不包含秘密、凭据指纹或本机路径。 */
import { isHuaweiUpdateDetails, type HuaweiUpdateDetails } from './huawei-updates.ts'
import {
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
import { isVivoUpdateDetails, type VivoUpdateDetails } from './vivo-updates.ts'
import { isOppoUpdateDetails, type OppoUpdateDetails } from './oppo-updates.ts'
import { isXiaomiUpdateDetails, type XiaomiUpdateDetails } from './xiaomi-updates.ts'
import { isRecord, type BindingChannel } from './applications.ts'

/** 本机档案的安全元数据；revision 只源自目录文件元数据，不计算凭据内容摘要。 */
export interface CredentialProfile {
  reference: string
  channel: BindingChannel
  configured: boolean
  revision: string
}

/** 不支持或损坏的存储必须明确展示，不能冒充空目录。 */
export interface ProfileCatalog {
  code: 'available' | 'unsupported_environment' | 'storage_unavailable'
  profiles: CredentialProfile[]
}

/** 固定公开结果码；供应商原始错误不得进入记录。 */
export const preflightMessages = {
  running: '正在只读核验',
  verified: '产物、凭据鉴权与商店应用匹配通过；上传权限尚未验证',
  credentials_unavailable: '本机凭据不可用，请到商店账号重新核对或重新录入，并检查钥匙串权限',
  invalid_credentials: '凭据无效或商店鉴权未通过，请核对 API 客户端 ID／密钥配置',
  rejected: '商店拒绝了本次鉴权或查询',
  query_rate_limited: '商店只读查询触发频率限制，本次未完成核验；请稍后重新准备',
  application_not_found: '商店中未找到目标应用',
  ambiguous_application: '商店返回多个目标，无法唯一确认',
  application_mismatch: '商店应用与保存的包身份或 App ID 不一致',
  network_unavailable: '网络不可用或请求超时，未能完成核验',
  invalid_response: '商店响应无法安全核对',
  vivo_version_not_newer: 'vivo 安装包构建号须为递增的正整数版本号，请选择高于商店版本的安装包',
  store_source_invalid: '商店现有版本资料缺失或不在当前更新范围内，请先在后台完善后重新准备',
  store_version_not_newer: '安装包版本未高于商店来源，请选择递增的新版本安装包',
  vivo_source_unavailable: 'vivo 来源版本或兼容设备缺失，无法安全更新，请在后台完善后重新准备',
  oppo_version_not_newer: 'OPPO 安装包构建号须高于商店最新版本，请选择递增的安装包',
  oppo_materials_unavailable:
    '无法复用 OPPO 现有资料，请在后台完善公开资料、测试说明与联系人后重新准备',
  store_materials_unavailable:
    '无法复用小米公开上架资料，请核对应用已上架、公开名称与后台一致，稍后重新准备',
  cancelled: '核验已中断',
  application_not_ready: '商店应用尚不具备查询条件',
  meizu_not_on_shelf: '魅族来源版本未确认为已上架状态，请先在后台处理审核或上下架流程后重新准备',
  meizu_pending_changes: '魅族已有同版本 APK 替换或资料修改待审核，请先在后台处理该修改后重新准备',
  meizu_recommendation_missing:
    '魅族现有版本缺少必填“推荐语”，请在魅族后台补齐，待资料可用于更新后重新准备',
  lookup_limit_exceeded: '查询超过安全范围，未能完成核验',
  unsupported_credential_method: '当前凭据方式不支持只读核验',
  artifact_invalid: '产物字节、摘要或身份复核失败',
  profile_changed: '核验期间凭据目录已变化，请重新核验',
  interrupted: '进程停止或重启，核验未完成',
  runner_unavailable: '本机核验进程未能完成任务',
} as const

/** 每次点击产生独立记录；通过不是发布授权。 */
export interface PreflightRecord {
  id: string
  workspaceId: string
  projectId: string
  applicationId: string
  bindingId: string
  /** 绑定编辑版本，不能复用于修改后的目标。 */
  bindingRevision: number
  artifactId: string
  /** 服务端检查实际字节所得的 SHA-256，小写十六进制。 */
  artifactSha256: string
  credentialReference: string
  /** 仅源自非秘密文件元数据，与凭据内容无关。 */
  profileRevision: string
  /** passed 仅表示三项只读检查通过，不代表发布授权。 */
  status: 'running' | 'passed' | 'failed' | 'unverified'
  code: keyof typeof preflightMessages
  artifact: 'passed' | 'unverified'
  authentication: 'passed' | 'unverified'
  target: 'passed' | 'unverified'
  /** 仅小米成功核验时自动读取的公开资料，不能包含测试账号。 */
  xiaomi?: XiaomiUpdateDetails
  /** 仅普通应用的公开字段，不含联系人、测试说明或商店密钥。 */
  oppo?: OppoUpdateDetails
  /** vivo 单包更新仅冻结来源版本与兼容设备。 */
  vivo?: VivoUpdateDetails
  /** 魅族来源不包含私人备案字段。 */
  meizu?: MeizuUpdateDetails
  /** 荣耀仅复用公开多语言资料。 */
  honor?: HonorUpdateDetails
  /** 新渠道来源仅由可信 worker 生成，不含私人资料。 */
  tencent?: TencentUpdateDetails
  harmony?: HarmonyUpdateDetails
  /** 仅华为正式更新准备读取；旧草稿预检不受更新资格限制。 */
  huawei?: HuaweiUpdateDetails
  uploadPermission: 'not_verified'
  /** 下列时间均为 ISO 8601 UTC；运行中 checkedAt／expiresAt 为 null。 */
  createdAt: string
  checkedAt: string | null
  expiresAt: string | null
}

/** 查询时重算有效性，保留历史事实，不把过期结果继续展示为可用。 */
export interface PreflightView {
  record: PreflightRecord
  current: boolean
  invalidatedBy:
    | null
    | 'expired'
    | 'binding_changed'
    | 'artifact_changed'
    | 'profile_changed'
    | 'profile_unavailable'
}

/** 请求只引用已保存对象与版本，不接受浏览器声明检查成功。 */
export interface CreatePreflight {
  bindingId: string
  artifactId: string
  expectedBindingRevision: number
  expectedProfileRevision: string
}

/** 安全引用边界供目录、CLI 与私有协议复用。 */
export function isProfileReference(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(value)
}

/** 不含凭据内容的目录版本，只接受固定编码。 */
export function isProfileRevision(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

/** 未知或多余字段拒绝进入浏览器和执行器。 */
export function isProfileCatalog(value: unknown): value is ProfileCatalog {
  return (
    isRecord(value) &&
    Object.keys(value).length === 2 &&
    typeof value.code === 'string' &&
    ['available', 'unsupported_environment', 'storage_unavailable'].includes(value.code) &&
    Array.isArray(value.profiles) &&
    value.profiles.every(
      (p) =>
        isRecord(p) &&
        Object.keys(p).length === 4 &&
        isProfileReference(p.reference) &&
        (p.channel === 'huawei' ||
          p.channel === 'app_store' ||
          p.channel === 'xiaomi' ||
          p.channel === 'oppo' ||
          p.channel === 'vivo' ||
          p.channel === 'meizu' ||
          p.channel === 'honor' ||
          p.channel === 'tencent' ||
          p.channel === 'harmony') &&
        typeof p.configured === 'boolean' &&
        isProfileRevision(p.revision),
    ) &&
    (value.code === 'available' || value.profiles.length === 0)
  )
}

/** 持久化与进程响应共同使用结构及状态不变量校验。 */
export function isPreflightRecord(value: unknown): value is PreflightRecord {
  if (
    !isRecord(value) ||
    Object.keys(value).length !==
      19 +
        (Object.hasOwn(value, 'huawei') ? 1 : 0) +
        (Object.hasOwn(value, 'meizu') ? 1 : 0) +
        (Object.hasOwn(value, 'honor') ? 1 : 0) +
        (Object.hasOwn(value, 'tencent') ? 1 : 0) +
        (Object.hasOwn(value, 'harmony') ? 1 : 0) +
        (Object.hasOwn(value, 'vivo') ? 1 : 0) +
        (Object.hasOwn(value, 'xiaomi') ? 1 : 0) +
        (Object.hasOwn(value, 'oppo') ? 1 : 0) ||
    (Object.hasOwn(value, 'huawei') &&
      (!isHuaweiUpdateDetails(value.huawei) ||
        value.code !== 'verified' ||
        ['harmony', 'tencent', 'meizu', 'honor', 'vivo', 'oppo', 'xiaomi'].some((k) =>
          Object.hasOwn(value, k),
        ))) ||
    (Object.hasOwn(value, 'tencent') &&
      (!isTencentUpdateDetails(value.tencent) ||
        value.code !== 'verified' ||
        value.artifact !== 'passed' ||
        value.authentication !== 'passed' ||
        value.target !== 'passed' ||
        ['harmony', 'meizu', 'honor', 'vivo', 'oppo', 'xiaomi'].some((k) =>
          Object.hasOwn(value, k),
        ))) ||
    (Object.hasOwn(value, 'harmony') &&
      (!isHarmonyUpdateDetails(value.harmony) ||
        value.code !== 'verified' ||
        value.artifact !== 'passed' ||
        value.authentication !== 'passed' ||
        value.target !== 'passed' ||
        ['tencent', 'meizu', 'honor', 'vivo', 'oppo', 'xiaomi'].some((k) =>
          Object.hasOwn(value, k),
        ))) ||
    (Object.hasOwn(value, 'meizu') &&
      (!isMeizuUpdateDetails(value.meizu) ||
        value.code !== 'verified' ||
        ['honor', 'vivo', 'oppo', 'xiaomi'].some((k) => Object.hasOwn(value, k)))) ||
    (Object.hasOwn(value, 'honor') &&
      (!isHonorUpdateDetails(value.honor) ||
        value.code !== 'verified' ||
        ['meizu', 'vivo', 'oppo', 'xiaomi'].some((k) => Object.hasOwn(value, k)))) ||
    (Object.hasOwn(value, 'vivo') &&
      (!isVivoUpdateDetails(value.vivo) ||
        value.code !== 'verified' ||
        Object.hasOwn(value, 'xiaomi') ||
        Object.hasOwn(value, 'oppo'))) ||
    (Object.hasOwn(value, 'oppo') &&
      (!isOppoUpdateDetails(value.oppo) ||
        value.code !== 'verified' ||
        Object.hasOwn(value, 'xiaomi'))) ||
    (Object.hasOwn(value, 'xiaomi') &&
      (!isXiaomiUpdateDetails(value.xiaomi) || value.code !== 'verified'))
  )
    return false
  const timestamps = ['createdAt', 'checkedAt', 'expiresAt']
  return (
    ['id', 'workspaceId', 'projectId', 'applicationId', 'bindingId', 'artifactId'].every(
      (k) => typeof value[k] === 'string' && value[k].length > 0 && value[k].length <= 255,
    ) &&
    typeof value.bindingRevision === 'number' &&
    Number.isSafeInteger(value.bindingRevision) &&
    value.bindingRevision > 0 &&
    isProfileRevision(value.artifactSha256) &&
    isProfileReference(value.credentialReference) &&
    isProfileRevision(value.profileRevision) &&
    typeof value.status === 'string' &&
    ['running', 'passed', 'failed', 'unverified'].includes(value.status) &&
    typeof value.code === 'string' &&
    Object.hasOwn(preflightMessages, value.code) &&
    ['artifact', 'authentication', 'target'].every(
      (k) => typeof value[k] === 'string' && ['passed', 'unverified'].includes(value[k]),
    ) &&
    value.uploadPermission === 'not_verified' &&
    timestamps.every(
      (k) =>
        (k !== 'createdAt' && value[k] === null) ||
        (typeof value[k] === 'string' &&
          Number.isFinite(Date.parse(value[k])) &&
          new Date(value[k]).toISOString() === value[k]),
    ) &&
    (value.status === 'running'
      ? value.code === 'running' && value.checkedAt === null && value.expiresAt === null
      : value.code !== 'running' && value.checkedAt !== null && value.expiresAt !== null) &&
    (value.status !== 'passed' ||
      (value.code === 'verified' &&
        value.artifact === 'passed' &&
        value.authentication === 'passed' &&
        value.target === 'passed')) &&
    (value.code !== 'verified' || value.status === 'passed')
  )
}

/** 当前有效仅表示该条事实未失效，不代表获得写操作授权。 */
export function isPreflightView(value: unknown): value is PreflightView {
  return (
    isRecord(value) &&
    Object.keys(value).length === 3 &&
    isPreflightRecord(value.record) &&
    typeof value.current === 'boolean' &&
    (value.invalidatedBy === null ||
      (typeof value.invalidatedBy === 'string' &&
        [
          'expired',
          'binding_changed',
          'artifact_changed',
          'profile_changed',
          'profile_unavailable',
        ].includes(value.invalidatedBy))) &&
    value.current === (value.invalidatedBy === null && value.record.status === 'passed')
  )
}
