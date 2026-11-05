/** @description Apple 已有构建审核与发布的公开事实；不含审核账号、JWT、原始响应或本机路径。 */
import { isRecord, isChannelBinding, type ChannelBinding } from './applications.ts'
import { hasExactKeys, isPlanId } from './release-plans.ts'
import { isProfileRevision } from './preflights.ts'

/** 远端状态原值为白名单样式字符串，页面显示查询时间，不冒充实时状态。 */
export interface AppleBuild {
  id: string
  version: string
  number: string
  state: string
  expired: boolean
  uploadedAt: string
}
/** 目标 App Store 版本；构建关系独立于版本号，必须核对。 */
export interface AppleVersion {
  id: string
  version: string
  state: string
  releaseType: string
  buildId: string | null
}
/** 显式查询的有界目录；缺项为固定码，不返回私人审核资料。 */
export interface AppleReviewCatalog {
  appId: string
  identifier: string
  builds: AppleBuild[]
  versions: AppleVersion[]
  checkedAt: string
}
/** 本次审核意图，说明同步已有语种；手动上线不修改说明。 */
export interface AppleReviewSnapshot {
  binding: ChannelBinding
  identifier: string
  action: 'submit' | 'release'
  build: AppleBuild
  version: AppleVersion
  mode: 'after_approval' | 'manual'
  notes: string
  /** 将同步更新说明的现有语种，手动上线为空。 */
  locales: string[]
  profileRevision: string
  sourceDigest: string
  checkedAt: string
}
/** 固定诊断不会保存 Apple 原始错误、测试账号或联系人。 */
export const appleReviewMessages = {
  ready: '检查完成，请核对摘要后确认',
  running: '正在执行已确认的 Apple 操作',
  submitted: 'Apple 已受理审核提交，尚不代表审核通过或上架',
  release_requested: 'Apple 已受理手动发布请求，尚不代表已上架',
  failed: '写入前检查失败，本次未修改 Apple 后台',
  interrupted: '写入前中断，本次未获商店写入许可',
  unknown: '远端结果待核对，系统不会自动重试',
  credentials: 'Apple API Key 不可读取或鉴权失败，请核对账号及 API 权限',
  network: 'Apple 查询未完成，请检查网络或稍后重试',
  target: 'Apple App ID、Bundle ID、构建或版本不匹配，请重新读取',
  build: '请选择已处理完成且未过期的 IOS 构建',
  version: '没有对应的可编辑 App Store 版本，请先在 Apple 后台创建或处理在审版本',
  active_review: 'Apple 当前已有未完成的审核集合，请先在后台处理，系统不会自动复用或删除',
  localization: '版本本地化资料不完整，请在后台完善名称对应的版本描述、支持网址和截图',
  review_contact: '审核联系人或必要的测试登录资料不完整，请在 Apple 后台完善',
  compliance: '构建加密合规信息尚未确定，请在 Apple 后台完善',
  changed: '账号、绑定、构建或商店来源发生变化，请重新准备',
  expired: '本次摘要已过期，请重新准备',
  rejected: 'Apple 拒绝了当前操作，请到后台查看资料或权限错误并核对是否部分完成',
  receipt: '未取得与本次操作匹配的 Apple 回执，请核对后台版本与审核集合',
} as const
/** 许可前后按同一固定码表达原因，不能据拒绝码推断已回滚前序步骤。 */
export type AppleReviewCode = keyof typeof appleReviewMessages
/** 同文件快照及执行事实；附加观察与人工声明不改写原始结果。 */
export interface AppleReviewRecord {
  id: string
  requestId: string
  snapshot: AppleReviewSnapshot
  digest: string
  createdAt: string
  expiresAt: string
  status: 'ready' | 'running' | 'succeeded' | 'failed' | 'interrupted' | 'unknown'
  code: AppleReviewCode
  consumedAt: string | null
  remoteStartedAt: string | null
  finishedAt: string | null
  observation?: { state: string; checkedAt: string }
  reconciliation?: { decision: 'present' | 'absent'; checkedAt: string; source: 'local_user' }
}
/** 受限 Apple 资源 ID 仅可作为固定路由片段，不允许路径或查询注入。 */
export function isAppleResourceId(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(v)
}
function text(v: unknown, max = 100): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= max && !/[\x00-\x1f]/.test(v)
}
function time(v: unknown): v is string {
  return typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v
}
function state(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Z_]{1,80}$/.test(v)
}
/** 目录构建守卫不接受任意属性或供应商正文。 */
export function isAppleBuild(v: unknown): v is AppleBuild {
  return (
    isRecord(v) &&
    hasExactKeys(v, ['id', 'version', 'number', 'state', 'expired', 'uploadedAt']) &&
    isAppleResourceId(v.id) &&
    text(v.version) &&
    text(v.number) &&
    state(v.state) &&
    typeof v.expired === 'boolean' &&
    time(v.uploadedAt)
  )
}
/** 商店版本守卫校验关联构建和公开状态。 */
export function isAppleVersion(v: unknown): v is AppleVersion {
  return (
    isRecord(v) &&
    hasExactKeys(v, ['id', 'version', 'state', 'releaseType', 'buildId']) &&
    isAppleResourceId(v.id) &&
    text(v.version) &&
    state(v.state) &&
    state(v.releaseType) &&
    (v.buildId === null || isAppleResourceId(v.buildId))
  )
}
/** 目录必须完整投影，超限或未知形状拒绝展示。 */
export function isAppleReviewCatalog(v: unknown): v is AppleReviewCatalog {
  return (
    isRecord(v) &&
    hasExactKeys(v, ['appId', 'identifier', 'builds', 'versions', 'checkedAt']) &&
    isAppleResourceId(v.appId) &&
    text(v.identifier, 255) &&
    Array.isArray(v.builds) &&
    v.builds.length <= 200 &&
    v.builds.every(isAppleBuild) &&
    Array.isArray(v.versions) &&
    v.versions.length <= 200 &&
    v.versions.every(isAppleVersion) &&
    time(v.checkedAt)
  )
}
/** 安全快照不因历史有效期过去而失去可读性。 */
export function isAppleReviewSnapshot(v: unknown): v is AppleReviewSnapshot {
  return (
    isRecord(v) &&
    hasExactKeys(v, [
      'binding',
      'identifier',
      'action',
      'build',
      'version',
      'mode',
      'notes',
      'locales',
      'profileRevision',
      'sourceDigest',
      'checkedAt',
    ]) &&
    isChannelBinding(v.binding) &&
    v.binding.channel === 'app_store' &&
    text(v.identifier, 255) &&
    (v.action === 'submit' || v.action === 'release') &&
    isAppleBuild(v.build) &&
    isAppleVersion(v.version) &&
    v.build.version === v.version.version &&
    (v.mode === 'after_approval' || v.mode === 'manual') &&
    Array.isArray(v.locales) &&
    v.locales.length <= 40 &&
    v.locales.every((l) => typeof l === 'string' && /^[A-Za-z0-9-]{1,40}$/.test(l)) &&
    new Set(v.locales).size === v.locales.length &&
    typeof v.notes === 'string' &&
    v.notes.length <= 4000 &&
    !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v.notes) &&
    (v.action === 'release' || v.notes.trim().length > 0) &&
    isProfileRevision(v.profileRevision) &&
    isProfileRevision(v.sourceDigest) &&
    time(v.checkedAt)
  )
}
/** 持久化状态与许可事实必须一致，防止假成功与恢复重放。 */
export function isAppleReviewRecord(v: unknown): v is AppleReviewRecord {
  if (
    !isRecord(v) ||
    !hasExactKeys(v, [
      'id',
      'requestId',
      'snapshot',
      'digest',
      'createdAt',
      'expiresAt',
      'status',
      'code',
      'consumedAt',
      'remoteStartedAt',
      'finishedAt',
      ...(Object.hasOwn(v, 'observation') ? ['observation'] : []),
      ...(Object.hasOwn(v, 'reconciliation') ? ['reconciliation'] : []),
    ]) ||
    !isPlanId(v.id) ||
    !isPlanId(v.requestId) ||
    !isAppleReviewSnapshot(v.snapshot) ||
    !isProfileRevision(v.digest) ||
    !time(v.createdAt) ||
    !time(v.expiresAt) ||
    Date.parse(v.expiresAt) <= Date.parse(v.createdAt) ||
    Date.parse(v.expiresAt) > Date.parse(v.createdAt) + 300000 ||
    typeof v.code !== 'string' ||
    !Object.hasOwn(appleReviewMessages, v.code)
  )
    return false
  if (
    v.consumedAt !== null &&
    (!time(v.consumedAt) || Date.parse(v.consumedAt) < Date.parse(v.createdAt))
  )
    return false
  if (
    v.remoteStartedAt !== null &&
    (!time(v.remoteStartedAt) ||
      !time(v.consumedAt) ||
      Date.parse(v.remoteStartedAt) < Date.parse(v.consumedAt))
  )
    return false
  if (
    v.finishedAt !== null &&
    (!time(v.finishedAt) ||
      !time(v.consumedAt) ||
      Date.parse(v.finishedAt) < Date.parse(v.remoteStartedAt ?? v.consumedAt))
  )
    return false
  if (
    v.observation !== undefined &&
    (!isRecord(v.observation) ||
      !hasExactKeys(v.observation, ['state', 'checkedAt']) ||
      !state(v.observation.state) ||
      !time(v.observation.checkedAt))
  )
    return false
  if (
    v.reconciliation !== undefined &&
    (!isRecord(v.reconciliation) ||
      !hasExactKeys(v.reconciliation, ['decision', 'checkedAt', 'source']) ||
      !['present', 'absent'].includes(String(v.reconciliation.decision)) ||
      v.reconciliation.source !== 'local_user' ||
      !time(v.reconciliation.checkedAt) ||
      !time(v.finishedAt) ||
      Date.parse(v.reconciliation.checkedAt) < Date.parse(v.finishedAt) ||
      v.status !== 'unknown')
  )
    return false
  return (
    (v.status === 'ready' &&
      v.code === 'ready' &&
      v.consumedAt === null &&
      v.remoteStartedAt === null &&
      v.finishedAt === null) ||
    (v.status === 'running' &&
      v.code === 'running' &&
      time(v.consumedAt) &&
      v.finishedAt === null) ||
    (v.status === 'succeeded' &&
      time(v.remoteStartedAt) &&
      time(v.finishedAt) &&
      v.code === (v.snapshot.action === 'submit' ? 'submitted' : 'release_requested')) ||
    (v.status === 'unknown' && time(v.remoteStartedAt) && time(v.finishedAt)) ||
    (['failed', 'interrupted'].includes(String(v.status)) &&
      time(v.consumedAt) &&
      v.remoteStartedAt === null &&
      time(v.finishedAt))
  )
}

/** 常见 Apple 版本状态的中文投影，未知状态保留安全原值，不推断成功。 */
export const appleVersionStates: Readonly<Record<string, string>> = {
  PREPARE_FOR_SUBMISSION: '准备提交',
  WAITING_FOR_REVIEW: '等待审核',
  IN_REVIEW: '审核中',
  REJECTED: '被拒绝',
  METADATA_REJECTED: '元数据被拒绝',
  DEVELOPER_REJECTED: '开发者已撤回',
  PENDING_DEVELOPER_RELEASE: '待开发者发布',
  PENDING_APPLE_RELEASE: '等待 Apple 发布',
  PROCESSING_FOR_APP_STORE: '商店处理中',
  READY_FOR_SALE: '已可销售',
  READY_FOR_DISTRIBUTION: '已可分发',
  INVALID_BINARY: '构建无效',
  REMOVED_FROM_SALE: '已下架',
  DEVELOPER_REMOVED_FROM_SALE: '开发者已下架',
}
