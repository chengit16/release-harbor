/** @description 可信 Node 适配上下文；批次使用真实未确认快照及独立窗口，不伪造单计划确认。 */
import type { ReleasePlan } from '@release-harbor/contracts'

/** 只能由已核对私有任务的 runner 构造，HTTP 不接收此对象。 */
export type StoreReleaseContext = ReleasePlan & {
  executionWindow?: { scope: 'local_batch_once'; issuedAt: string; expiresAt: string }
}
/** 旧单计划沿用其五分钟授权，批次仅检查独立固定窗口；最终写许可仍由父进程决定。 */
export function storeWindowCurrent(context: StoreReleaseContext): boolean {
  const window = context.executionWindow ?? context.authorization
  return (
    !!window &&
    Date.now() >= Date.parse(window.issuedAt) &&
    Date.now() < Date.parse(window.expiresAt)
  )
}
/** SDK 的动作确认时间取可信入口窗口，不创建产品 local_once 授权。 */
export function storeConfirmationTime(context: StoreReleaseContext): string {
  return context.executionWindow?.issuedAt ?? context.authorization?.issuedAt ?? ''
}
