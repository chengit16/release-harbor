/** @description 送审成功后取得的安全版本锚点；只关联商店版本，不包含账号、权限或原始响应。 */
import { isRecord } from './applications.ts'
import { hasExactKeys } from './release-plans.ts'
import { isStoreId } from './store-updates.ts'

/** 魅族发布回执与确定版本的关联；旧回执缺失时不可按名称猜测或回填。 */
export interface ReviewAnchor {
  channel: 'meizu'
  versionId: string
}
/** IPC 与持久化共用白名单，只允许十进制平台版本 ID。 */
export function isReviewAnchor(value: unknown): value is ReviewAnchor {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['channel', 'versionId']) &&
    value.channel === 'meizu' &&
    isStoreId(value.versionId)
  )
}
