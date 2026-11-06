/** @description 审核状态菜单同源只读汇总；运行时验证安全摘要，不自动触发商店查询。 */
import { isReviewTrackingResponse, type ReviewTrackingResponse } from '@release-harbor/contracts'
import { request } from '../client.ts'
/** 导航、筛选和刷新只读取本机事实，失败按原公共错误边界展示。 */
export function loadReviewTracking(signal: AbortSignal): Promise<ReviewTrackingResponse> {
  return request(
    '/api/review-tracking',
    (value) => {
      if (!isReviewTrackingResponse(value)) throw new Error('审核状态汇总格式不正确')
      return value
    },
    { signal, cache: 'no-store' },
  )
}
