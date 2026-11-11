/** @description 请求与后台任务共享可信成员上下文；敏感动作每次读取安装级目录，撤权不依赖浏览器刷新。 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { DomainError, planFingerprint } from '@release-harbor/domain'
import type {
  ChannelBinding,
  TeamMenu,
  TeamOperation,
  TeamReleaseAction,
  TeamBindingGrant,
} from '@release-harbor/contracts'
import type { LocalTeamStore, TeamAccount } from './store.ts'

/** 权限上下文仅由认证边界建立，不能由 HTTP 输入指定。 */
export interface TeamActor {
  store: LocalTeamStore
  id: string
  revision: number
  /** 请求会话退出或到期后，后台任务也不能继续获得新许可。 */
  valid?: (accounts: TeamAccount[]) => boolean
}
/** 异步链包括准备轮询和独立执行回调；个人模式没有成员上下文。 */
export const teamContext = new AsyncLocalStorage<TeamActor | undefined>()
/** 对绑定完整配置取指纹；改绑账号、目标和版本均使原授权失效。 */
export function teamBindingFingerprint(binding: ChannelBinding): string {
  return planFingerprint(binding)
}
/** 每次执行读取当前账号；停用、重置和目录故障均拒绝后续许可。 */
export async function currentTeamAccount(
  actor = teamContext.getStore(),
): Promise<TeamAccount | undefined> {
  if (!actor) return undefined
  const accounts = await actor.store.read()
  const account = accounts?.find((a) => a.id === actor.id)
  if (
    !account?.enabled ||
    account.revision !== actor.revision ||
    (actor.valid && (!accounts || !actor.valid(accounts)))
  )
    throw new DomainError('成员会话已失效，请重新登录', 401)
  return account
}
/** 菜单隐藏只负责体验，服务端所有资源和动作还需再次检查。 */
export function teamHasMenu(account: TeamAccount | undefined, menu: TeamMenu): boolean {
  return !account || account.role === 'admin' || !!account.permissions?.menus.includes(menu)
}
/** 缺省操作表示只读发布目录，审核缓存须明确授予 review_read。 */
export function teamCanBinding(
  account: TeamAccount | undefined,
  binding: ChannelBinding,
  operation?: TeamOperation,
  action?: TeamReleaseAction,
): boolean {
  if (!account || account.role === 'admin') return true
  const menu = operation === 'review_read' || operation === 'review_query' ? 'reviews' : 'releases'
  if (!teamHasMenu(account, menu)) return false
  const grant = teamBindingGrant(account, binding)
  return (
    !!grant &&
    (!operation || grant.operations.includes(operation)) &&
    (!action || grant.releaseActions.includes(action))
  )
}
/** 绑定范围独立于菜单，用于受限应用目录。 */
export function teamBindingGrant(
  account: TeamAccount,
  binding: ChannelBinding,
): TeamBindingGrant | undefined {
  return account.permissions?.grants.find(
    (g) =>
      g.projectId === binding.projectId &&
      g.applicationId === binding.applicationId &&
      g.bindingId === binding.id &&
      g.fingerprint === teamBindingFingerprint(binding),
  )
}
/** 临冻结和临许可时调用；保留旧保护，仅追加当前成员资格检查。 */
export async function assertTeamBinding(
  binding: ChannelBinding,
  operation: TeamOperation,
  action?: TeamReleaseAction,
): Promise<void> {
  if (!teamCanBinding(await currentTeamAccount(), binding, operation, action))
    throw new DomainError('当前成员没有此渠道或动作的权限，请联系管理员', 403)
}
/** 许可回调可能由长期 worker 触发，显式捕获发起上下文，避免继承其他请求身份。 */
export function captureTeamCheck(): typeof assertTeamBinding {
  const actor = teamContext.getStore()
  return (binding, operation, action) =>
    teamContext.run(actor, () => assertTeamBinding(binding, operation, action))
}
