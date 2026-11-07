/** @description 官方查询结果的范围文案；公开在架、版本资料与无版本关联的审核流程分别解释。 */
import {
  storeVersionStates,
  type BindingChannel,
  type StoreVersionStatus,
} from '@release-harbor/contracts'

/** 状态不变更原始结果；限定不同渠道证据能表达的结论。 */
export function storeStatusLabel(channel: BindingChannel, version: StoreVersionStatus): string {
  if (channel === 'xiaomi' && version.state === 'published') return '公开在架'
  if (version.state === 'unknown' && (version.versionName || version.buildNumber))
    return '已读取版本资料，审核未确认'
  return storeVersionStates[version.state]
}

/** 应用宝审核接口没有版本标识，不能让缺失字段看起来像已关联线上包。 */
export function storeVersionTitle(channel: BindingChannel, version: StoreVersionStatus): string {
  if (channel === 'tencent' && !version.versionName && !version.buildNumber)
    return '当前审核流程（官方未返回对应版本）'
  return version.versionName ?? '商店未提供版本名'
}
