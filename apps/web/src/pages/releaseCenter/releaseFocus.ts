/** @description 首页待处理分组的纯判断，仅读取服务端摘要，不把普通失败或过期误判为未知结果。 */
import type { ReleaseCenterItem } from '@release-harbor/contracts'

/** 快捷入口只改变列表范围，实际操作仍进入原详情并重新核对。 */
export function matchesReleaseFocus(item: ReleaseCenterItem, focus: string): boolean {
  if (!focus) return true
  if (focus === 'processing') return item.state === 'processing'
  if (focus === 'confirmation')
    return item.state === 'awaiting_confirmation' || item.state === 'awaiting_execution'
  if (focus === 'reconciliation') return item.needsReconciliation
  return false
}
