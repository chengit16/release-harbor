/** @description 商店账号目录及保存结果的安全合同；不包含材料、配置令牌或本机路径。 */
import { isProfileReference, isProfileRevision, type ProfileCatalog } from './preflights.ts'
import { isRecord, type BindingChannel } from './applications.ts'

/** 可信绑定投影的应用名称；项目用于区分同名应用，不含商店身份或凭据材料。 */
export interface CredentialAccountApplication {
  id: string
  name: string
  projectName: string
}

/** 账号是用户命名的档案，配置存在不证明商店鉴权或上传权限。 */
export interface CredentialAccount {
  reference: string
  displayName: string
  channel: BindingChannel
  configured: boolean
  revision: string
  /** 账号管理乐观版本，与预检使用的材料目录版本独立。 */
  managementRevision: string
  /** CLI 创建且尚无页面标签的旧档案。 */
  legacy: boolean
  /** 存储状态不明时禁止选择，即使 Vault 中仍有旧元数据。 */
  needsReconciliation: boolean
  /** 控制面从当前绑定关系计算；本机原始目录默认为 0。 */
  applicationCount: number
  /** 控制面补充关联名称；独立配置进程及旧目录可省略，不把缺失解释为空关联。 */
  applications?: CredentialAccountApplication[]
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
    (Object.keys(value).length === 9 ||
      (Object.keys(value).length === 10 && 'applications' in value)) &&
    isProfileReference(value.reference) &&
    typeof value.displayName === 'string' &&
    value.displayName.length > 0 &&
    value.displayName.length <= 160 &&
    (value.channel === 'huawei' ||
      value.channel === 'app_store' ||
      value.channel === 'xiaomi' ||
      value.channel === 'oppo' ||
      value.channel === 'vivo' ||
      value.channel === 'meizu' ||
      value.channel === 'honor' ||
      value.channel === 'tencent' ||
      value.channel === 'harmony') &&
    typeof value.configured === 'boolean' &&
    isProfileRevision(value.revision) &&
    isProfileRevision(value.managementRevision) &&
    typeof value.legacy === 'boolean' &&
    typeof value.needsReconciliation === 'boolean' &&
    typeof value.applicationCount === 'number' &&
    Number.isSafeInteger(value.applicationCount) &&
    value.applicationCount >= 0 &&
    (!('applications' in value) ||
      (Array.isArray(value.applications) &&
        value.applications.length === value.applicationCount &&
        value.applications.every(
          (application) =>
            isRecord(application) &&
            Object.keys(application).length === 3 &&
            ['id', 'name', 'projectName'].every(
              (key) => typeof application[key] === 'string' && application[key].length > 0,
            ),
        ) &&
        new Set(value.applications.map((application) => application.id)).size ===
          value.applications.length))
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
    (value.channel === 'huawei' ||
      value.channel === 'app_store' ||
      value.channel === 'xiaomi' ||
      value.channel === 'oppo' ||
      value.channel === 'vivo' ||
      value.channel === 'meizu' ||
      value.channel === 'honor' ||
      value.channel === 'tencent' ||
      value.channel === 'harmony') &&
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

/** 账号管理只接收公开引用和预期版本，不接受秘密或浏览器声明的关联数量。 */
export type CredentialAccountAction = {
  reference: string
  expectedRevision: string
} & ({ action: 'recheck' | 'delete' } | { action: 'rename'; displayName: string })

/** 重新录入保留原引用，预期版本必须与创建能力和实际提交时的状态一致。 */
export interface CredentialReplacement {
  reference: string
  expectedRevision: string
}

/** 本机核对只证明材料可读取及格式有效，不证明商店鉴权、目标或上传权限。 */
export interface CredentialAccountResult {
  code: 'checked' | 'needs_input' | 'renamed' | 'deleted'
}

/** 管理入口严格拒绝秘密及未约定字段。 */
export function isCredentialAccountAction(value: unknown): value is CredentialAccountAction {
  return (
    isRecord(value) &&
    isProfileReference(value.reference) &&
    isProfileRevision(value.expectedRevision) &&
    (((value.action === 'recheck' || value.action === 'delete') &&
      Object.keys(value).length === 3) ||
      (value.action === 'rename' &&
        Object.keys(value).length === 4 &&
        typeof value.displayName === 'string' &&
        value.displayName.trim().length > 0 &&
        value.displayName.trim().length <= 60 &&
        !/[\x00-\x1f\x7f]/.test(value.displayName)))
  )
}

/** 替换能力不允许改变渠道、名称或传入材料。 */
export function isCredentialReplacement(value: unknown): value is CredentialReplacement {
  return (
    isRecord(value) &&
    Object.keys(value).length === 2 &&
    isProfileReference(value.reference) &&
    isProfileRevision(value.expectedRevision)
  )
}

/** 安全结果仅包含固定枚举，不传播供应商异常。 */
export function isCredentialAccountResult(value: unknown): value is CredentialAccountResult {
  return (
    isRecord(value) &&
    Object.keys(value).length === 1 &&
    typeof value.code === 'string' &&
    ['checked', 'needs_input', 'renamed', 'deleted'].includes(value.code)
  )
}
