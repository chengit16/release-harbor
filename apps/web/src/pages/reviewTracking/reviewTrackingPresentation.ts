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

/** 来源随记录渠道显示，缺少观察时不暗示已发生查询。 */
export function reviewObservationSource(item: ReviewTrackingItem): string {
  return item.observation ? (item.channel === 'meizu' ? '魅族 API' : '荣耀 API') : 'Apple 已有观察'
}
/** 老魅族记录缺锚点与尚未接入的渠道分别说明，避免引导用户重复提交。 */
export function reviewQueryHint(item: ReviewTrackingItem): string {
  if (item.querySupported) return '尚无查询记录'
  if (item.channel === 'meizu') return '历史记录缺少送审版本 ID，请到后台核对'
  if (item.channel === 'xiaomi') return '官方未开放查询'
  if (item.channel === 'app_store') return '可在发布工作区刷新'
  return '查询能力待接入'
}
