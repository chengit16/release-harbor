/** @description 在线目录的公开视图；不携带发行者身份、会话或设备凭据。 */

/** 当前空间的角色；仅供页面展示和操作提示，授权由服务端重新检查。 */
export const hostedRoles = ['admin', 'operator', 'viewer'] as const

/** 管理员、发布操作员和查看者；本切片仅管理员维护目录。 */
export type HostedRole = (typeof hostedRoles)[number]

/** 当前会话有效的工作空间及成员角色；空间 ID 是定位参数。 */
export interface HostedWorkspace {
  /** 由服务端生成的空间 ID。 */
  id: string
  /** 工作空间名称。 */
  name: string
  /** 供组织识别的稳定短标识。 */
  key: string
  /** 当前有效成员角色。 */
  role: HostedRole
}

/** 当前会话的目录入口；撤销成员后可返回空列表。 */
export interface HostedSessionView {
  /** 当前会话有权访问的空间。 */
  workspaces: HostedWorkspace[]
}

/** 管理员可见的成员安全投影，不返回发行者或 subject。 */
export interface HostedMember {
  /** 当前空间内的成员 ID。 */
  id: string
  /** 管理员指定的显示名称。 */
  label: string
  /** 当前有效角色。 */
  role: HostedRole
}

/** 按已知 OIDC subject 预登记成员，发行者由服务端配置。 */
export interface CreateHostedMember {
  /** 身份提供方给此客户端的稳定 subject；不是邮箱或登录凭据。 */
  subject: string
  /** 空间内显示名称。 */
  label: string
  /** 拟授予角色，由服务端检查操作者权限。 */
  role: HostedRole
}
