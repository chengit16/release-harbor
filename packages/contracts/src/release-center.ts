/**
 * @description 发布中心只读汇总合同
 * 仅传输项目与应用选择项、发布记录列表摘要及可导航定位，不包含商店资料、凭据引用或执行权限。
 */
import { attemptMessages, type ReleaseAttempt } from './release-attempts.ts'
import {
  isRecord,
  isBindingChannel,
  type ApplicationPlatform,
  type BindingChannel,
} from './applications.ts'
import { hasExactKeys, planInvalidationMessages, type ReleasePlan } from './release-plans.ts'
import type { ReleasePlanView } from './release-plans.ts'
import type { BatchTargetStatus } from './release-batches.ts'

/** 发布中心按真实记录归纳的当前处理阶段，不等同于商店审核或上架状态。 */
export type ReleaseCenterState =
  | 'draft'
  | 'awaiting_confirmation'
  | 'awaiting_execution'
  | 'processing'
  | 'attention'
  | 'completed'
  | 'cancelled'

/** 只用于筛选和发起入口的公开应用摘要。 */
export interface ReleaseCenterApplicationOption {
  /** 当前可信工作空间内应用 ID。 */
  id: string
  /** 用户可识别的应用名称。 */
  name: string
  /** 应用平台，决定原有发布流程的可用动作。 */
  platform: ApplicationPlatform
}

/** 项目筛选项及其应用，不承载项目描述或其他配置。 */
export interface ReleaseCenterProjectOption {
  /** 当前可信工作空间内项目 ID。 */
  id: string
  /** 用户可识别的项目名称。 */
  name: string
  /** 当前项目下的公开应用选项。 */
  applications: ReleaseCenterApplicationOption[]
}

/** 计划记录中足以显示执行回执的信息；不含授权标识、诊断细节或原始回执。 */
export interface ReleaseCenterAttemptSummary {
  /** 已持久化执行尝试的状态。 */
  status: ReleaseAttempt['status']
  /** 固定的执行结果代码，用于显示准确的结果说明。 */
  code: keyof typeof attemptMessages
}

/** 发布中心列表项公共身份和版本摘要。 */
interface ReleaseCenterItemBase {
  /** 原发布计划或批次 ID，仅用于定位，不构成授权。 */
  id: string
  /** 项目定位及只读名称。 */
  projectId: string
  projectName: string
  /** 应用定位、名称及平台。 */
  applicationId: string
  applicationName: string
  platform: ApplicationPlatform
  /** 当前记录涉及的商店；删除绑定后可能无法从历史草稿还原渠道。 */
  channels: BindingChannel[]
  createdAt: string
  versionName: string | null
  buildNumber: string | null
  state: ReleaseCenterState
}

/** 单渠道不可变计划的摘要，执行回执与审核／上架观察仍分开显示。 */
export interface ReleaseCenterPlanItem extends ReleaseCenterItemBase {
  kind: 'plan'
  planStatus: ReleasePlan['status']
  current: boolean
  invalidatedBy: ReleasePlanView['invalidatedBy']
  attempt: ReleaseCenterAttemptSummary | null
}

/** 多渠道批次摘要；逐渠道回执保留各自状态，不被一个总体成功标志覆盖。 */
export interface ReleaseCenterBatchItem extends ReleaseCenterItemBase {
  kind: 'batch'
  revisionId: string | null
  targets: Array<{ channel: BindingChannel | null; status: BatchTargetStatus }>
}

/** 发布中心可筛选的发布记录。 */
export type ReleaseCenterItem = ReleaseCenterPlanItem | ReleaseCenterBatchItem

/** 单次本机只读查询的全部结果；没有历史的应用仍保留在可发起选择项中。 */
export interface ReleaseCenterResponse {
  projects: ReleaseCenterProjectOption[]
  items: ReleaseCenterItem[]
}

const states: readonly ReleaseCenterState[] = [
  'draft',
  'awaiting_confirmation',
  'awaiting_execution',
  'processing',
  'attention',
  'completed',
  'cancelled',
]
const attemptStatuses: readonly ReleaseAttempt['status'][] = [
  'preparing',
  'running',
  'succeeded',
  'failed',
  'interrupted',
  'needs_reconciliation',
]
const batchStatuses: readonly BatchTargetStatus[] = [
  'pending',
  'checking',
  'ready',
  'failed',
  'queued',
  'verifying',
  'running',
  'succeeded',
  'needs_reconciliation',
  'stopped',
  'expired',
  'interrupted',
]

function isApplicationPlatform(value: unknown): value is ApplicationPlatform {
  return value === 'android' || value === 'ios' || value === 'harmony'
}

function isTime(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  )
}

function isProjectOption(value: unknown): value is ReleaseCenterProjectOption {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['id', 'name', 'applications']) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    Array.isArray(value.applications) &&
    value.applications.every(
      (application) =>
        isRecord(application) &&
        hasExactKeys(application, ['id', 'name', 'platform']) &&
        typeof application.id === 'string' &&
        typeof application.name === 'string' &&
        isApplicationPlatform(application.platform),
    )
  )
}

function isBase(value: Record<string, unknown>): boolean {
  return (
    typeof value.id === 'string' &&
    typeof value.projectId === 'string' &&
    typeof value.projectName === 'string' &&
    typeof value.applicationId === 'string' &&
    typeof value.applicationName === 'string' &&
    isApplicationPlatform(value.platform) &&
    Array.isArray(value.channels) &&
    value.channels.every(isBindingChannel) &&
    isTime(value.createdAt) &&
    (value.versionName === null || typeof value.versionName === 'string') &&
    (value.buildNumber === null || typeof value.buildNumber === 'string') &&
    states.some((state) => state === value.state)
  )
}

function isPlanItem(value: Record<string, unknown>): boolean {
  return (
    hasExactKeys(value, [
      'id',
      'projectId',
      'projectName',
      'applicationId',
      'applicationName',
      'platform',
      'channels',
      'createdAt',
      'versionName',
      'buildNumber',
      'state',
      'kind',
      'planStatus',
      'current',
      'invalidatedBy',
      'attempt',
    ]) &&
    isBase(value) &&
    value.kind === 'plan' &&
    ['frozen', 'confirmed', 'cancelled'].includes(String(value.planStatus)) &&
    typeof value.current === 'boolean' &&
    (value.invalidatedBy === null ||
      (typeof value.invalidatedBy === 'string' &&
        Object.hasOwn(planInvalidationMessages, value.invalidatedBy))) &&
    (value.attempt === null ||
      (isRecord(value.attempt) &&
        hasExactKeys(value.attempt, ['status', 'code']) &&
        attemptStatuses.some(
          (status) => isRecord(value.attempt) && status === value.attempt.status,
        ) &&
        typeof value.attempt.code === 'string' &&
        Object.hasOwn(attemptMessages, value.attempt.code)))
  )
}

function isBatchItem(value: Record<string, unknown>): boolean {
  return (
    hasExactKeys(value, [
      'id',
      'projectId',
      'projectName',
      'applicationId',
      'applicationName',
      'platform',
      'channels',
      'createdAt',
      'versionName',
      'buildNumber',
      'state',
      'kind',
      'revisionId',
      'targets',
    ]) &&
    isBase(value) &&
    value.kind === 'batch' &&
    (value.revisionId === null || typeof value.revisionId === 'string') &&
    Array.isArray(value.targets) &&
    value.targets.every(
      (target) =>
        isRecord(target) &&
        hasExactKeys(target, ['channel', 'status']) &&
        (target.channel === null || isBindingChannel(target.channel)) &&
        batchStatuses.some((status) => status === target.status),
    )
  )
}

/** 严格验证汇总响应，阻止内部对象或意外字段穿过公共 API。 */
export function isReleaseCenterResponse(value: unknown): value is ReleaseCenterResponse {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['projects', 'items']) &&
    Array.isArray(value.projects) &&
    value.projects.every(isProjectOption) &&
    Array.isArray(value.items) &&
    value.items.every(
      (item) =>
        isRecord(item) &&
        (item.kind === 'plan' ? isPlanItem(item) : item.kind === 'batch' && isBatchItem(item)),
    )
  )
}
