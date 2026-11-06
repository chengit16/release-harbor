/** @description 审核状态展示文案，颜色只表达已知观察，不从操作受理推断审核成功。 */
import type { ReviewTrackingItem } from '@release-harbor/contracts'
/** 原始未知与未获取状态分别使用警示和中性色。 */
export function reviewStateColor(state: ReviewTrackingItem['state']): string {
  return state === 'rejected'
    ? 'error'
    : state === 'published'
      ? 'success'
      : state === 'unknown'
        ? 'warning'
        : state === 'not_queried'
          ? 'default'
          : 'processing'
}
/** 同一 iOS 版本的送审与手动发布分别标识，未知回执不猜测动作。 */
export function reviewRecordLabel(item: ReviewTrackingItem): string {
  if (item.kind === 'plan') return '渠道审核提交'
  return item.receiptCode === 'release_requested'
    ? '手动发布请求'
    : item.receiptCode === 'submitted'
      ? '提交审核'
      : 'Apple 操作记录'
}
