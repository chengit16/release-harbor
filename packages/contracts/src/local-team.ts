/** @description 本机工作台账号公开投影；不公开凭据摘要、会话能力或文件位置。 */
import { isLocalTeamPermissions, type LocalTeamPermissions } from './local-team-permissions.ts'
import { isRecord } from './applications.ts'

/** 管理员接管原工作台；成员业务操作须经逐项授权。 */
export interface LocalTeamMember {
  /** 本机账号的稳定标识。 */
  id: string
  username: string
  role: 'admin' | 'member'
  enabled: boolean
  /** 缺省权限兼容 T1 成员，等同没有业务授权。 */
  permissions?: LocalTeamPermissions
}

/** 首屏由服务端给出运行和登录状态，客户端不可推定为个人模式。 */
export type LocalTeamSession =
  | { mode: 'personal' | 'signed_out' }
  | { mode: 'signed_in'; member: LocalTeamMember }

/** 拒绝未满足公开账号合同的响应。 */
export function isLocalTeamMember(value: unknown): value is LocalTeamMember {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.username === 'string' &&
    (value.role === 'admin' || value.role === 'member') &&
    typeof value.enabled === 'boolean' &&
    (value.permissions === undefined || isLocalTeamPermissions(value.permissions))
  )
}

/** 解析会话投影，只有显式个人模式才能进入免登录工作台。 */
export function isLocalTeamSession(value: unknown): value is LocalTeamSession {
  return (
    isRecord(value) &&
    (value.mode === 'personal' ||
      value.mode === 'signed_out' ||
      (value.mode === 'signed_in' && isLocalTeamMember(value.member)))
  )
}
