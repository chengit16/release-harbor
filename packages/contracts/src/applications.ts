/**
 * @description 应用身份与首批商店绑定的公开数据合同
 * 不含凭据材料或本机路径；运行时守卫仅验证传输结构，不替代领域授权。
 */

/** 已开放配置维护的平台；不表示发布执行已经实现。 */
export type ApplicationPlatform = 'android' | 'ios'
/** 首批允许配置的商店，与 SDK 平台类型保持隔离。 */
export type BindingChannel = 'huawei' | 'app_store'

/** 平台应用身份；创建后平台与 identifier 保持不变。 */
export interface Application {
  id: string
  /** 由可信入口确定，不接受浏览器指定归属。 */
  workspaceId: string
  projectId: string
  name: string
  platform: ApplicationPlatform
  /** Android 包名或 iOS Bundle ID，保留大小写，不是商店 appId。 */
  identifier: string
  /** ISO 8601 UTC 创建时间。 */
  createdAt: string
}

/** 应用创建输入，归属由 URL 和可信上下文共同确定。 */
export interface CreateApplication {
  name: string
  platform: ApplicationPlatform
  identifier: string
}

/** 商店配置快照；保存配置不代表目标、账号或发布权限已验证。 */
export interface ChannelBinding {
  id: string
  workspaceId: string
  projectId: string
  applicationId: string
  channel: BindingChannel
  /** 商店中的独立目标标识，不从包名推导。 */
  appId: string
  /** 本机凭据提供器的公开别名，不是密码、Token 或文件路径。 */
  credentialReference: string
  /** 每次编辑递增，后续预检及计划必须绑定该版本。 */
  revision: number
  /** 当前尚未实现预检，不能因引用存在而标为有效。 */
  verification: 'not_checked'
  /** 以下时间均为 ISO 8601 UTC。 */
  createdAt: string
  updatedAt: string
}

/** 新增商店绑定，不接收客户端的状态和版本。 */
export interface CreateChannelBinding {
  channel: BindingChannel
  appId: string
  credentialReference: string
}

/** 完整替换可编辑配置；旧版本写入必须产生冲突。 */
export interface UpdateChannelBinding {
  appId: string
  credentialReference: string
  expectedRevision: number
}

/** 未知 JSON 的对象边界，供公开响应解码使用。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 验证应用传输结构，不执行归属或唯一性判断。 */
export function isApplication(value: unknown): value is Application {
  return (
    isRecord(value) &&
    ['id', 'workspaceId', 'projectId', 'name', 'identifier', 'createdAt'].every(
      (key) => typeof value[key] === 'string' && value[key].length > 0,
    ) &&
    (value.platform === 'android' || value.platform === 'ios')
  )
}

/** 验证绑定结构，未知预检状态或非法版本不得被误解为可执行。 */
export function isChannelBinding(value: unknown): value is ChannelBinding {
  return (
    isRecord(value) &&
    [
      'id',
      'workspaceId',
      'projectId',
      'applicationId',
      'appId',
      'credentialReference',
      'createdAt',
      'updatedAt',
    ].every((key) => typeof value[key] === 'string' && value[key].length > 0) &&
    (value.channel === 'huawei' || value.channel === 'app_store') &&
    typeof value.revision === 'number' &&
    Number.isSafeInteger(value.revision) &&
    value.revision > 0 &&
    value.verification === 'not_checked'
  )
}
