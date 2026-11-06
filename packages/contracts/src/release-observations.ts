/** @description 版本级商店状态观察的公开合同；执行回执、查询观察和人工核对独立，不承载凭据或执行权限。 */
import { isStoreId } from './store-updates.ts'
import { isRecord } from './applications.ts'
import { hasExactKeys, isPlanId } from './release-plans.ts'

/** 仅投影有明确平台依据的状态；审核通过不能直接归为已上架。 */
export const releaseObservationStates = {
  unknown: '尚无法确认',
  in_review: '审核中',
  rejected: '审核未通过',
  approved: '审核通过',
  published: '已上架',
  removed: '已下架',
} as const
/** 查询失败不覆盖上一条成功观察，固定原因不包含平台原始错误。 */
export const releaseObservationCodes = {
  observed: '已核对本次版本的商店状态',
  version_mismatch: '商店当前流程对应其他版本，无法确认本次发布状态',
  authentication: '商店凭据不可读取或鉴权失败，请核对账号及查询权限',
  network: '商店查询未完成，请稍后重试或到后台核对',
  invalid_response: '商店未返回可验证的目标或状态，无法确认',
  changed: '应用绑定或账号配置已变化，请核对当前应用配置',
  interrupted: '本次查询已中断，未取得可核对的商店状态',
} as const
/** 查询结果中的安全白名单；非本次版本时只显示未知，不借用旧版本的审核状态。 */
export interface ReleaseObservationResult {
  state: keyof typeof releaseObservationStates
  code: keyof typeof releaseObservationCodes
  /** 平台原始状态码，仅保留有限整数；null 表示未取得可核对的状态。 */
  rawState: number | null
}
/** 荣耀按当前版本匹配，魅族按可信送审回执中的确定版本 ID 查询。 */
export interface ReleaseObservation extends ReleaseObservationResult {
  id: string
  planId: string
  projectId: string
  applicationId: string
  channel: 'honor' | 'meizu'
  source: 'honor_current_release' | 'honor_published_version' | 'meizu_version_detail'
  /** 魅族必需的版本锚点；荣耀历史保持原字段形状。 */
  versionId?: string
  versionName: string
  buildNumber: string
  requestedAt: string
  checkedAt: string
  /** 下一次允许显式查询的时间，不表示系统会自动查询。 */
  nextQueryAt: string
}
function time(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  )
}
/** 私有进程回报及公开 API 共用守卫，拒绝正文、私密材料和未知字段。 */
export function isReleaseObservationResult(value: unknown): value is ReleaseObservationResult {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['state', 'code', 'rawState']) &&
    observationFields(value)
  )
}
function observationFields(value: Record<string, unknown>): boolean {
  return (
    typeof value.state === 'string' &&
    Object.hasOwn(releaseObservationStates, value.state) &&
    typeof value.code === 'string' &&
    Object.hasOwn(releaseObservationCodes, value.code) &&
    (value.rawState === null ||
      (typeof value.rawState === 'number' &&
        Number.isSafeInteger(value.rawState) &&
        value.rawState >= 0 &&
        value.rawState <= 1000)) &&
    (value.code === 'observed' || (value.state === 'unknown' && value.rawState === null))
  )
}
/** 历史过期仍可读取；时间仅表示观察事实，不能作为新执行授权。 */
export function isReleaseObservation(value: unknown): value is ReleaseObservation {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'id',
      'planId',
      'projectId',
      'applicationId',
      'channel',
      'source',
      'versionName',
      'buildNumber',
      'requestedAt',
      'checkedAt',
      'nextQueryAt',
      'state',
      'code',
      'rawState',
      ...(Object.hasOwn(value, 'versionId') ? ['versionId'] : []),
    ]) &&
    observationFields(value) &&
    [value.id, value.planId, value.projectId, value.applicationId].every(isPlanId) &&
    ((value.channel === 'honor' &&
      !Object.hasOwn(value, 'versionId') &&
      value.source ===
        (value.state === 'published' ? 'honor_published_version' : 'honor_current_release')) ||
      (value.channel === 'meizu' &&
        value.source === 'meizu_version_detail' &&
        isStoreId(value.versionId))) &&
    [value.versionName, value.buildNumber].every(
      (v) => typeof v === 'string' && v.length > 0 && v.length <= 255 && !/[\x00-\x1f]/.test(v),
    ) &&
    time(value.requestedAt) &&
    time(value.checkedAt) &&
    time(value.nextQueryAt) &&
    Date.parse(value.checkedAt) >= Date.parse(value.requestedAt) &&
    Date.parse(value.nextQueryAt) ===
      Date.parse(value.checkedAt) + (value.code === 'observed' ? 10800000 : 60000)
  )
}
