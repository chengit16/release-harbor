/** @description 成员菜单与动作的界面提示；权限权威仍在服务端，客户端不产生执行授权。 */
import { createContext, useContext, type ReactNode } from 'react'
import type {
  LocalTeamMember,
  TeamMenu,
  TeamOperation,
  TeamReleaseAction,
  ChannelBinding,
} from '@release-harbor/contracts'

const TeamIdentity = createContext<LocalTeamMember | undefined>(undefined)
/** 按账号隔离界面，身份变化由 TeamGate 重建业务树。 */
export function TeamAccessProvider({
  member,
  children,
}: {
  /** 当前身份。 */ member?: LocalTeamMember
  /** 业务页面。 */ children: ReactNode
}) {
  return <TeamIdentity.Provider value={member}>{children}</TeamIdentity.Provider>
}
/** 当前成员身份，不读取账号或会话秘密。 */
export function useTeamIdentity(): LocalTeamMember | undefined {
  return useContext(TeamIdentity)
}
/** 菜单与按钮权限仅用于展示；服务端同时复核绑定指纹及最新目录。 */
export function useTeamAccess() {
  const member = useTeamIdentity()
  const restricted = member?.role === 'member'
  function applicationPermission(
    applicationId: string | undefined,
    operation: TeamOperation,
  ): boolean | undefined {
    const grant = member?.permissions?.applications?.find((g) => g.applicationId === applicationId)
    return grant ? grant.operations.includes(operation) : undefined
  }
  return {
    restricted,
    application: (applicationId: string, operation: TeamOperation) =>
      !restricted ||
      (applicationPermission(applicationId, operation) ??
        !!member.permissions?.grants.some(
          (g) => g.applicationId === applicationId && g.operations.includes(operation),
        )),
    menu: (menu: TeamMenu) => !restricted || !!member.permissions?.menus.includes(menu),
    can: (
      target: string | Pick<ChannelBinding, 'id' | 'applicationId'>,
      operation: TeamOperation,
      action?: TeamReleaseAction,
      applicationId?: string,
    ) =>
      !restricted ||
      (applicationPermission(
        typeof target === 'string' ? applicationId : target.applicationId,
        operation,
      ) ??
        !!member.permissions?.grants.some(
          (g) =>
            g.bindingId === (typeof target === 'string' ? target : target.id) &&
            g.operations.includes(operation) &&
            (!action || g.releaseActions.includes(action)),
        )),
  }
}
