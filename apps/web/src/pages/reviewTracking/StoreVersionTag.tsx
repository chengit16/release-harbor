/** @description 商店版本状态标签；列表、手机卡片与详情共享颜色语义，不改变官方状态结论。 */
import { Tag } from 'antd'
import {
  storeVersionStates,
  type BindingChannel,
  type StoreVersionStatus,
} from '@release-harbor/contracts'
import { storeStatusLabel } from './storeStatusPresentation.ts'

const colors = {
  unpublished: 'default',
  draft: 'default',
  withdrawn: 'default',
  superseded: 'default',
  pending_release: 'warning',
  pending_manual_release: 'warning',
  pending_store_release: 'processing',
  removal_pending: 'warning',
  removal_rejected: 'error',
  pre_review: 'processing',
  pre_rejected: 'error',
  in_review: 'processing',
  rejected: 'error',
  approved: 'success',
  qualification_review: 'processing',
  qualification_approved: 'cyan',
  qualification_rejected: 'error',
  operations_approved: 'cyan',
  filing_submitted: 'default',
  frozen: 'warning',
  published: 'success',
  removed: 'default',
  processing: 'processing',
  unknown: 'warning',
} satisfies Record<StoreVersionStatus['state'], string>

/** 文字保留状态及渠道限定，避免只凭颜色判断或将小米公开在架误认为本次审核通过。 */
export function StoreVersionTag({
  channel,
  version,
  manual = false,
}: {
  /** 绑定渠道决定是否需要“公开在架”等范围限定。 */
  channel: BindingChannel
  /** 官方安全投影；未知状态保留提示，不在前端猜测。 */
  version: StoreVersionStatus
  /** 人工记录使用普通状态名，由邻近来源标签区分，不冒称公开在架或官方结果。 */
  manual?: boolean
}) {
  return (
    <Tag className="store-version-status-tag" color={colors[version.state]}>
      {manual ? storeVersionStates[version.state] : storeStatusLabel(channel, version)}
    </Tag>
  )
}
