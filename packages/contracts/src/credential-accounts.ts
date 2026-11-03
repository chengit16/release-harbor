/** @description 商店账号目录及保存结果的安全合同；不包含材料、配置令牌或本机路径。 */
import { isProfileReference, isProfileRevision, type ProfileCatalog } from './preflights.ts'
import { isRecord, type BindingChannel } from './applications.ts'

/** 账号是用户命名的档案，配置存在不证明商店鉴权或上传权限。 */
export interface CredentialAccount {
  reference: string
  displayName: string
  channel: BindingChannel
  configured: boolean
  revision: string
  /** CLI 创建且尚无页面标签的旧档案。 */
  legacy: boolean
  /** 存储状态不明时禁止选择，即使 Vault 中仍有旧元数据。 */
  needsReconciliation: boolean
  /** 控制面从当前绑定关系计算；本机原始目录默认为 0。 */
  applicationCount: number
}

/** 本机目录状态仅表示环境和文件可读，不读取安全库中的秘密。 */
export interface CredentialAccounts {
  code: ProfileCatalog['code']
  accounts: CredentialAccount[]
}

/** 公开保存状态，错误码不带 SDK 原文。 */
export interface CredentialOperation {
  id: string
  reference: string
  channel: BindingChannel
  displayName: string
  status: 'saving' | 'saved' | 'failed' | 'needs_reconciliation'
  code: 'saving' | 'saved' | 'storage_failed' | 'needs_reconciliation'
  createdAt: string
}

/** 目录响应拒绝多余字段，防止内部对象进入工作台。 */
export function isCredentialAccounts(value: unknown): value is CredentialAccounts {
  return (
    isRecord(value) &&
    Object.keys(value).length === 2 &&
    (value.code === 'available' ||
      value.code === 'unsupported_environment' ||
      value.code === 'storage_unavailable') &&
    Array.isArray(value.accounts) &&
    value.accounts.every(isCredentialAccount) &&
    (value.code === 'available' || value.accounts.length === 0)
  )
}

/** 单个账号的全部字段必须符合安全投影。 */
export function isCredentialAccount(value: unknown): value is CredentialAccount {
  return (
    isRecord(value) &&
    Object.keys(value).length === 8 &&
    isProfileReference(value.reference) &&
    typeof value.displayName === 'string' &&
    value.displayName.length > 0 &&
    value.displayName.length <= 160 &&
    (value.channel === 'huawei' || value.channel === 'app_store') &&
    typeof value.configured === 'boolean' &&
    isProfileRevision(value.revision) &&
    typeof value.legacy === 'boolean' &&
    typeof value.needsReconciliation === 'boolean' &&
    typeof value.applicationCount === 'number' &&
    Number.isSafeInteger(value.applicationCount) &&
    value.applicationCount >= 0
  )
}

/** 操作 ID 只用于查找，访问范围仍由可信入口核对。 */
export function isCredentialOperation(value: unknown): value is CredentialOperation {
  return (
    isRecord(value) &&
    Object.keys(value).length === 7 &&
    typeof value.id === 'string' &&
    /^[a-f0-9-]{36}$/.test(value.id) &&
    isProfileReference(value.reference) &&
    (value.channel === 'huawei' || value.channel === 'app_store') &&
    typeof value.displayName === 'string' &&
    value.displayName.length > 0 &&
    value.displayName.length <= 60 &&
    ((value.status === 'saving' && value.code === 'saving') ||
      (value.status === 'saved' && value.code === 'saved') ||
      (value.status === 'failed' && value.code === 'storage_failed') ||
      (value.status === 'needs_reconciliation' && value.code === 'needs_reconciliation')) &&
    typeof value.createdAt === 'string' &&
    Number.isFinite(Date.parse(value.createdAt))
  )
}
