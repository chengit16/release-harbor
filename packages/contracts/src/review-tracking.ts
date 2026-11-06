/** @description 审核状态独立菜单的安全汇总合同；仅读取提交回执及已有观察，不携带快照、账号或授权。 */
import {
  isRecord,
  isBindingChannel,
  type ApplicationPlatform,
  type BindingChannel,
} from './applications.ts'
import { hasExactKeys, isPlanId } from './release-plans.ts'
import { attemptMessages } from './release-attempts.ts'
import { appleReviewMessages, type AppleReviewRecord } from './apple-review.ts'
import {
  isReleaseObservation,
  releaseObservationStates,
  type ReleaseObservation,
} from './release-observations.ts'
import type { ReleaseCenterProjectOption } from './release-center.ts'

/** 没有观察时明确显示未获取，不从提交回执推断审核中。 */
export const reviewTrackingStates = {
  not_queried: '未获取状态',
  ...releaseObservationStates,
} as const
/** 待处理项来自当前已知事实；后台核对及操作仍由用户明确进行。 */
export const reviewTrackingTodos = {
  query: '查询审核状态',
  review_rejection: '查看审核意见并处理',
  verify: '核对结果或查询问题',
  wait: '等待审核与发布',
  manual_release: '到发布中心手动发布',
  store_console: '到商店后台核对',
  none: '暂无待处理项',
} as const
/** 列表公共身份及状态摘要，只能用于导航，不能作为执行权限。 */
interface ReviewTrackingBase {
  id: string
  projectId: string
  projectName: string
  applicationId: string
  applicationName: string
  platform: ApplicationPlatform
  channel: BindingChannel
  versionName: string
  buildNumber: string
  createdAt: string
  state: keyof typeof reviewTrackingStates
  todo: keyof typeof reviewTrackingTodos
  /** 最近一次荣耀查询，包含失败事实；null 表示没有查询。 */
  observation: ReleaseObservation | null
  /** iOS 已有明确查询形成的历史观察，不自动请求 Apple。 */
  appleObservation: NonNullable<AppleReviewRecord['observation']> | null
}
/** 单渠道或批次子计划按渠道独立展示，原回执码保持原意。 */
export interface ReviewTrackingPlanItem extends ReviewTrackingBase {
  kind: 'plan'
  receiptCode: keyof typeof attemptMessages
}
/** 只展示已发生远端操作的 Apple 送审／手动发布，不把构建上传当作送审。 */
export interface ReviewTrackingAppleItem extends ReviewTrackingBase {
  kind: 'apple'
  receiptCode: keyof typeof appleReviewMessages
}
/** 同一列表中区分原计划与 Apple 记录，详情查询仍走原归属校验端点。 */
export type ReviewTrackingItem = ReviewTrackingPlanItem | ReviewTrackingAppleItem
/** 当前可信空间内的目录与安全摘要，空历史应用仍可筛选。 */
export interface ReviewTrackingResponse {
  projects: ReleaseCenterProjectOption[]
  items: ReviewTrackingItem[]
}
function time(v: unknown): v is string {
  return typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v
}
function text(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= 255 && !/[\x00-\x1f]/.test(v)
}
/** 严格验证汇总形状及观察归属，阻止意外传播内部对象或另一记录的状态。 */
export function isReviewTrackingResponse(v: unknown): v is ReviewTrackingResponse {
  return (
    isRecord(v) &&
    hasExactKeys(v, ['projects', 'items']) &&
    Array.isArray(v.projects) &&
    v.projects.every(
      (p) =>
        isRecord(p) &&
        hasExactKeys(p, ['id', 'name', 'applications']) &&
        isPlanId(p.id) &&
        text(p.name) &&
        Array.isArray(p.applications) &&
        p.applications.every(
          (a) =>
            isRecord(a) &&
            hasExactKeys(a, ['id', 'name', 'platform']) &&
            isPlanId(a.id) &&
            text(a.name) &&
            ['android', 'ios', 'harmony'].includes(String(a.platform)),
        ),
    ) &&
    Array.isArray(v.items) &&
    v.items.every(isReviewTrackingItem)
  )
}
function isReviewTrackingItem(v: unknown): v is ReviewTrackingItem {
  return (
    isRecord(v) &&
    hasExactKeys(v, [
      'id',
      'projectId',
      'projectName',
      'applicationId',
      'applicationName',
      'platform',
      'channel',
      'versionName',
      'buildNumber',
      'createdAt',
      'state',
      'todo',
      'observation',
      'appleObservation',
      'kind',
      'receiptCode',
    ]) &&
    [v.id, v.projectId, v.applicationId].every(isPlanId) &&
    [v.projectName, v.applicationName, v.versionName, v.buildNumber].every(text) &&
    ['android', 'ios', 'harmony'].includes(String(v.platform)) &&
    isBindingChannel(v.channel) &&
    time(v.createdAt) &&
    typeof v.state === 'string' &&
    Object.hasOwn(reviewTrackingStates, v.state) &&
    typeof v.todo === 'string' &&
    Object.hasOwn(reviewTrackingTodos, v.todo) &&
    typeof v.receiptCode === 'string' &&
    ((v.kind === 'plan' && Object.hasOwn(attemptMessages, v.receiptCode)) ||
      (v.kind === 'apple' &&
        v.channel === 'app_store' &&
        v.platform === 'ios' &&
        Object.hasOwn(appleReviewMessages, v.receiptCode))) &&
    (v.observation === null ||
      (isReleaseObservation(v.observation) &&
        v.kind === 'plan' &&
        v.channel === 'honor' &&
        v.observation.planId === v.id &&
        v.observation.projectId === v.projectId &&
        v.observation.applicationId === v.applicationId &&
        v.observation.versionName === v.versionName &&
        v.observation.buildNumber === v.buildNumber)) &&
    (v.appleObservation === null ||
      (v.kind === 'apple' &&
        isRecord(v.appleObservation) &&
        hasExactKeys(v.appleObservation, ['state', 'checkedAt']) &&
        typeof v.appleObservation.state === 'string' &&
        /^[A-Z_]{1,80}$/.test(v.appleObservation.state) &&
        time(v.appleObservation.checkedAt)))
  )
}
