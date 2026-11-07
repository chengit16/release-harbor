/** @description 送审成功后取得的安全版本锚点；只关联商店版本，不包含账号、权限或原始响应。 */
import { isRecord } from './applications.ts'
import { hasExactKeys } from './release-plans.ts'
import type { ReleasePlanSnapshot } from './release-plans.ts'
import { isStoreId, isStoreReceiptId } from './store-updates.ts'

/** 魅族版本 ID 或荣耀审核单 ID 与原执行的关联；旧回执缺失时不可按名称猜测或回填。 */
export interface ReviewAnchor {
  channel: 'meizu' | 'honor'
  versionId: string
}
/** IPC 与持久化共用白名单，魅族使用十进制版本 ID，荣耀使用平台发布流程字符串。 */
export function isReviewAnchor(value: unknown): value is ReviewAnchor {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['channel', 'versionId']) &&
    ((value.channel === 'meizu' && isStoreId(value.versionId)) ||
      (value.channel === 'honor' && isStoreReceiptId(value.versionId)))
  )
}

/** 新锚点必须匹配同次执行的渠道与动作，并区别于准备阶段来源版本。 */
export function reviewAnchorMatches(anchor: ReviewAnchor, snapshot: ReleasePlanSnapshot): boolean {
  return (
    (anchor.channel === 'meizu' &&
      snapshot.action === 'meizu_submit_review' &&
      snapshot.binding.channel === 'meizu' &&
      anchor.versionId !== snapshot.meizu?.sourceVersionId) ||
    (anchor.channel === 'honor' &&
      snapshot.action === 'honor_submit_review' &&
      snapshot.binding.channel === 'honor' &&
      anchor.versionId !== snapshot.honor?.sourceReleaseId)
  )
}
