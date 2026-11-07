/** @description 独立商店状态查询合同；目标来自已保存绑定，结果来自用户明确触发的只读商店查询。 */
import {
  isRecord,
  isBindingChannel,
  isChannelBinding,
  type BindingChannel,
  type ChannelBinding,
} from './applications.ts'
import { hasExactKeys, isPlanId } from './release-plans.ts'
import {
  isStoreMaterialReport,
  isStoreRejectionSummary,
  type StoreRejectionSummary,
  type StoreMaterialReport,
} from './store-materials.ts'
import {
  isStoreVersionQuery,
  isStoreManualRecord,
  type StoreVersionQuery,
  type StoreManualRecord,
} from './store-tracking.ts'

/** 只允许可解释的有限状态；未知平台码不推测审核阶段。 */
export const storeVersionStates = {
  unpublished: '未发布',
  draft: '草稿',
  withdrawn: '已撤审',
  superseded: '已被新版本替代',
  pending_release: '待上架',
  pending_manual_release: '等待手动发布',
  pending_store_release: '等待商店发布',
  removal_pending: '下架申请中',
  removal_rejected: '下架审核未通过',
  pre_review: '预审中',
  pre_rejected: '预审未通过',
  in_review: '审核中',
  rejected: '审核未通过',
  approved: '审核通过',
  qualification_review: '资质审核中',
  qualification_approved: '资质审核通过',
  qualification_rejected: '资质审核未通过',
  operations_approved: '运营审核通过',
  filing_submitted: '报备提交成功',
  frozen: '已冻结',
  published: '已上架',
  removed: '已下架',
  processing: '处理中',
  unknown: '尚无法确认',
} as const

/** 绑定摘要只用于选择查询目标，不向浏览器暴露凭据引用。 */
export interface StoreStatusTarget {
  bindingId: string
  projectId: string
  projectName: string
  applicationId: string
  applicationName: string
  platform: 'android' | 'ios' | 'harmony'
  identifier: string
  channel: BindingChannel
  appId: string
  querySupported: boolean
  /** 包含未支持原因或已接入能力的精度限制；null 表示无额外提示。 */
  queryNotice: string | null
}

/** 单个商店版本的安全状态投影，不包含原始响应、审核意见或资源 URL。 */
export interface StoreVersionStatus {
  versionId: string | null
  versionName: string | null
  /** 商店未提供时保持 null，不能从本机发布历史猜测。 */
  buildNumber: string | null
  state: keyof typeof storeVersionStates
  /** 仅保存可无损表达的非负平台整数码；含前导零或负号的渠道码不转数值。 */
  rawState: number | null
  /** 仅属于此条版本资料；不把在架材料关联到其他审核流程。 */
  materials?: StoreMaterialReport
  /** 仅拒绝状态可带有限分类，不包含原文或附件。 */
  rejection?: StoreRejectionSummary
}

/** 每次显式刷新形成一次快照；未支持查询也以明确原因返回，不伪装成空结果。 */
export interface StoreStatusSnapshot {
  bindingId: string
  channel: BindingChannel
  checkedAt: string
  code:
    | 'observed'
    | 'unsupported'
    | 'authentication'
    | 'network'
    | 'invalid_response'
    | 'request_rejected'
  versions: StoreVersionStatus[]
  /** 有值时只描述该构建的查询，不替换默认目录结果。旧缓存无此字段。 */
  query?: StoreVersionQuery
  /** 独立资料检查范围；不替换官方状态目录或推断执行关联。 */
  materialVersionId?: string
  /** 仅指定确定版本检查成功时存在，失败不携带旧结论。 */
  materials?: StoreMaterialReport
}

/** 私有执行任务仅携带已恢复的绑定和应用事实，凭据引用不会进入公开响应。 */
export interface StoreStatusJob {
  binding: ChannelBinding
  identifier: string
  /** 只读定位由控制面校验渠道和格式，worker 再次核对。 */
  query?: StoreVersionQuery
  /** 明确点击才检查此 Apple／魅族版本，必须在绑定的官方目录中再次核对归属。 */
  materialVersionId?: string
}

/** 独立菜单的目录响应；目标目录与查询快照分离，未查询绑定仍可展示。 */
export interface StoreStatusResponse {
  targets: StoreStatusTarget[]
  snapshots: StoreStatusSnapshot[]
  /** 指定构建的缓存独立于默认目录；每个构建保留最近失败和上次成功。 */
  trackedSnapshots?: StoreStatusSnapshot[]
  /** 人工记录仅对应当前绑定指纹，独立展示来源。 */
  manualRecords?: StoreManualRecord[]
  /** 启用留存后每个绑定最近三十次官方查询；最近完成在前，旧缓存不回填历史。 */
  queryHistory?: StoreStatusSnapshot[]
  /** 每绑定最近五个指定版本，各保留最近失败及上次成功，独立于状态查询历史。 */
  materialSnapshots?: StoreStatusSnapshot[]
}

function text(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 255 &&
    !/[\x00-\x1f]/.test(value)
  )
}

/** GET 目标目录严格投影，禁止泄漏凭据引用或未识别应用状态。 */
export function isStoreStatusTarget(value: unknown): value is StoreStatusTarget {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'bindingId',
      'projectId',
      'projectName',
      'applicationId',
      'applicationName',
      'platform',
      'identifier',
      'channel',
      'appId',
      'querySupported',
      'queryNotice',
    ]) &&
    [value.bindingId, value.projectId, value.applicationId].every(isPlanId) &&
    [value.projectName, value.applicationName, value.identifier, value.appId].every(text) &&
    ['android', 'ios', 'harmony'].includes(String(value.platform)) &&
    isBindingChannel(value.channel) &&
    typeof value.querySupported === 'boolean' &&
    (value.queryNotice === null || text(value.queryNotice)) &&
    (!value.querySupported ? text(value.queryNotice) : true)
  )
}

/** 私有 worker、API 与页面共用的状态快照守卫。 */
export function isStoreStatusSnapshot(value: unknown): value is StoreStatusSnapshot {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'bindingId',
      'channel',
      'checkedAt',
      'code',
      'versions',
      ...(Object.hasOwn(value, 'query') ? ['query'] : []),
      ...(Object.hasOwn(value, 'materialVersionId') ? ['materialVersionId'] : []),
      ...(Object.hasOwn(value, 'materials') ? ['materials'] : []),
    ]) &&
    (!Object.hasOwn(value, 'query') ||
      (value.channel === 'oppo' && isStoreVersionQuery(value.query))) &&
    isPlanId(value.bindingId) &&
    isBindingChannel(value.channel) &&
    typeof value.checkedAt === 'string' &&
    Number.isFinite(Date.parse(value.checkedAt)) &&
    new Date(value.checkedAt).toISOString() === value.checkedAt &&
    [
      'observed',
      'unsupported',
      'authentication',
      'network',
      'invalid_response',
      'request_rejected',
    ].includes(String(value.code)) &&
    Array.isArray(value.versions) &&
    value.versions.length <= 200 &&
    value.versions.every(
      (version) =>
        isRecord(version) &&
        hasExactKeys(version, [
          'versionId',
          'versionName',
          'buildNumber',
          'state',
          'rawState',
          ...(Object.hasOwn(version, 'materials') ? ['materials'] : []),
          ...(Object.hasOwn(version, 'rejection') ? ['rejection'] : []),
        ]) &&
        (!Object.hasOwn(version, 'materials') || isStoreMaterialReport(version.materials)) &&
        (!Object.hasOwn(version, 'rejection') ||
          (['rejected', 'pre_rejected', 'qualification_rejected', 'removal_rejected'].includes(
            String(version.state),
          ) &&
            isStoreRejectionSummary(version.rejection))) &&
        (version.versionId === null || text(version.versionId)) &&
        (version.versionName === null || text(version.versionName)) &&
        (version.buildNumber === null || text(version.buildNumber)) &&
        typeof version.state === 'string' &&
        Object.hasOwn(storeVersionStates, version.state) &&
        (version.rawState === null ||
          (typeof version.rawState === 'number' &&
            Number.isSafeInteger(version.rawState) &&
            version.rawState >= 0 &&
            version.rawState <= 1000)),
    ) &&
    (value.code === 'observed' || value.versions.length === 0) &&
    (!isStoreVersionQuery(value.query) ||
      value.code !== 'observed' ||
      (value.versions.length === 1 &&
        value.versions[0]?.buildNumber === value.query.buildNumber)) &&
    (Object.hasOwn(value, 'materialVersionId')
      ? ['app_store', 'meizu'].includes(String(value.channel)) &&
        !Object.hasOwn(value, 'query') &&
        /^[A-Za-z0-9_-]{1,120}$/.test(String(value.materialVersionId)) &&
        (value.code === 'observed'
          ? value.versions.length === 1 &&
            value.versions[0]?.versionId === value.materialVersionId &&
            isStoreMaterialReport(value.materials)
          : !Object.hasOwn(value, 'materials'))
      : !Object.hasOwn(value, 'materials'))
  )
}

/** 私有 worker 载荷守卫，拒绝浏览器注入的商店目标和凭据范围。 */
export function isStoreStatusJob(value: unknown): value is StoreStatusJob {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'binding',
      'identifier',
      ...(Object.hasOwn(value, 'query') ? ['query'] : []),
      ...(Object.hasOwn(value, 'materialVersionId') ? ['materialVersionId'] : []),
    ]) &&
    text(value.identifier) &&
    isChannelBinding(value.binding) &&
    (!Object.hasOwn(value, 'query') ||
      (value.binding.channel === 'oppo' && isStoreVersionQuery(value.query))) &&
    (!Object.hasOwn(value, 'materialVersionId') ||
      (['app_store', 'meizu'].includes(value.binding.channel) &&
        !Object.hasOwn(value, 'query') &&
        /^[A-Za-z0-9_-]{1,120}$/.test(String(value.materialVersionId))))
  )
}

/** 独立菜单响应守卫，拒绝内部绑定、原始商店正文和未关联快照。 */
export function isStoreStatusResponse(value: unknown): value is StoreStatusResponse {
  if (!isRecord(value) || !Array.isArray(value.targets)) return false
  const targets = value.targets
  const trackedSnapshots = Array.isArray(value.trackedSnapshots) ? value.trackedSnapshots : []
  const queryHistory = Array.isArray(value.queryHistory) ? value.queryHistory : []
  const materialSnapshots = Array.isArray(value.materialSnapshots) ? value.materialSnapshots : []
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'targets',
      'snapshots',
      ...(Object.hasOwn(value, 'trackedSnapshots') ? ['trackedSnapshots'] : []),
      ...(Object.hasOwn(value, 'manualRecords') ? ['manualRecords'] : []),
      ...(Object.hasOwn(value, 'queryHistory') ? ['queryHistory'] : []),
      ...(Object.hasOwn(value, 'materialSnapshots') ? ['materialSnapshots'] : []),
    ]) &&
    Array.isArray(value.targets) &&
    value.targets.every(isStoreStatusTarget) &&
    Array.isArray(value.snapshots) &&
    value.snapshots.every(isStoreStatusSnapshot) &&
    value.snapshots.every((snapshot) => !snapshot.query && !snapshot.materialVersionId) &&
    (!Object.hasOwn(value, 'trackedSnapshots') ||
      (Array.isArray(value.trackedSnapshots) &&
        value.trackedSnapshots.every(
          (snapshot) => isStoreStatusSnapshot(snapshot) && !!snapshot.query,
        ))) &&
    (!Object.hasOwn(value, 'manualRecords') ||
      (Array.isArray(value.manualRecords) &&
        value.manualRecords.every(isStoreManualRecord) &&
        value.manualRecords.every((record) =>
          targets.some(
            (target) =>
              isStoreStatusTarget(target) &&
              target.bindingId === record.bindingId &&
              target.channel === 'xiaomi',
          ),
        ))) &&
    (!Object.hasOwn(value, 'queryHistory') ||
      (Array.isArray(value.queryHistory) &&
        value.queryHistory.every(
          (item) => isStoreStatusSnapshot(item) && !item.materialVersionId,
        ) &&
        targets.every(
          (target) =>
            isStoreStatusTarget(target) &&
            queryHistory.filter((item) => item.bindingId === target.bindingId).length <= 30,
        ))) &&
    (!Object.hasOwn(value, 'materialSnapshots') ||
      (Array.isArray(value.materialSnapshots) &&
        materialSnapshots.every(
          (item) => isStoreStatusSnapshot(item) && !!item.materialVersionId,
        ) &&
        targets.every(
          (target) =>
            materialSnapshots.filter((item) => item.bindingId === target.bindingId).length <= 10,
        ))) &&
    [...value.snapshots, ...trackedSnapshots, ...queryHistory, ...materialSnapshots].every(
      (snapshot) =>
        targets.some(
          (target) =>
            isStoreStatusTarget(target) &&
            target.bindingId === snapshot.bindingId &&
            target.channel === snapshot.channel,
        ),
    )
  )
}
