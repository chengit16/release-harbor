/** @description 凭据目录与只读预检公开合同，不包含秘密、凭据指纹或本机路径。 */
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
  credentials_unavailable: '凭据不可用，请通过本机 CLI 配置并检查 Keychain 权限',
  invalid_credentials: '凭据格式不正确',
  rejected: '商店拒绝了本次鉴权或查询',
  application_not_found: '商店中未找到目标应用',
  ambiguous_application: '商店返回多个目标，无法唯一确认',
  application_mismatch: '商店应用与保存的包身份或 App ID 不一致',
  network_unavailable: '网络不可用或请求超时，未能完成核验',
  invalid_response: '商店响应无法安全核对',
  cancelled: '核验已中断',
  application_not_ready: '商店应用尚不具备查询条件',
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
        (p.channel === 'huawei' || p.channel === 'app_store') &&
        typeof p.configured === 'boolean' &&
        isProfileRevision(p.revision),
    ) &&
    (value.code === 'available' || value.profiles.length === 0)
  )
}

/** 持久化与进程响应共同使用结构及状态不变量校验。 */
export function isPreflightRecord(value: unknown): value is PreflightRecord {
  if (!isRecord(value) || Object.keys(value).length !== 19) return false
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
