/** @description 本机增强公开合同；不含凭据、执行授权或服务器文件路径。 */
import { isRecord } from './applications.ts'
import { hasExactKeys, isPlanId } from './release-plans.ts'

/** 备份摘要仅描述业务数据，不代表包含账号秘密或安装包字节。 */
export interface LocalBackup {
  id: string
  createdAt: string
  automatic: boolean
  sizeBytes: number
  files: number
}
/** 恢复预览由服务端保存，确认绑定此摘要，不接受客户端自定义路径。 */
export interface RestorePreview {
  id: string
  digest: string
  createdAt: string
  sourceCreatedAt: string
  currentFiles: number
  restoredFiles: number
  sameInstallation: boolean
  /** 首版不备份原文件；这些元数据恢复后须重新检查字节。 */
  artifactRecords: number
  credentialAccounts: number
}
/** 固定版本或应用级观察；空版本只表示应用级，不能冒充新包审核跟踪。 */
export interface LocalFollow {
  id: string
  projectId: string
  applicationId: string
  bindingId: string
  label: string
  fingerprint: string
  versionId: string | null
  buildNumber: string | null
  intervalMinutes: 15 | 30 | 60
  until: 'review' | 'published'
  status: 'active' | 'paused' | 'ended'
  reason: string
  nextAt: string
  expiresAt: string
  lastAt: string | null
  failures: number
  baseline: Record<string, string>
}
/** 通知只读定位到原详情，不包含自动执行能力；观察时间不是商店实际变化时间。 */
export interface LocalNotice {
  id: string
  eventKey: string
  title: string
  detail: string
  createdAt: string
  read: boolean
  projectId: string | null
  applicationId: string | null
  bindingId: string | null
}
/** 本机设置与有界记录，GET 不触发备份或商店请求。 */
export interface LocalEfficiencyState {
  schemaVersion: 1
  autoBackup: boolean
  lastBackupAttemptAt: string | null
  lastBackupAt: string | null
  backupError: string | null
  browserNotifications: boolean
  showApplicationName: boolean
  follows: LocalFollow[]
  notices: LocalNotice[]
}
/** 设置页面响应不返回备份正文或内部安全账本。 */
export interface LocalEfficiencyView {
  state: LocalEfficiencyState
  backups: LocalBackup[]
  restarting: boolean
  recoveryReadOnly: boolean
}
const time = (v: unknown): v is string =>
  typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v
const text = (v: unknown, max = 300): v is string =>
  typeof v === 'string' && v.length <= max && !/[\x00-\x1f\x7f]/.test(v)
/** 校验有界通知，拒绝附加秘密字段。 */
export function isLocalNotice(v: unknown): v is LocalNotice {
  return (
    isRecord(v) &&
    hasExactKeys(v, [
      'id',
      'eventKey',
      'title',
      'detail',
      'createdAt',
      'read',
      'projectId',
      'applicationId',
      'bindingId',
    ]) &&
    isPlanId(v.id) &&
    typeof v.eventKey === 'string' &&
    /^[a-f0-9]{64}$/.test(v.eventKey) &&
    text(v.title) &&
    text(v.detail, 600) &&
    time(v.createdAt) &&
    typeof v.read === 'boolean' &&
    [v.projectId, v.applicationId, v.bindingId].every((x) => x === null || isPlanId(x))
  )
}
/** 跟踪任务来自可信绑定，磁盘读取仍完整验证，不放宽外部输入。 */
export function isLocalFollow(v: unknown): v is LocalFollow {
  return (
    isRecord(v) &&
    hasExactKeys(v, [
      'id',
      'projectId',
      'applicationId',
      'bindingId',
      'label',
      'fingerprint',
      'versionId',
      'buildNumber',
      'intervalMinutes',
      'until',
      'status',
      'reason',
      'nextAt',
      'expiresAt',
      'lastAt',
      'failures',
      'baseline',
    ]) &&
    [v.id, v.projectId, v.applicationId, v.bindingId].every(isPlanId) &&
    text(v.label) &&
    typeof v.fingerprint === 'string' &&
    /^[a-f0-9]{64}$/.test(v.fingerprint) &&
    [v.versionId, v.buildNumber].every((x) => x === null || (text(x, 120) && x.length > 0)) &&
    typeof v.intervalMinutes === 'number' &&
    [15, 30, 60].includes(v.intervalMinutes) &&
    ['review', 'published'].includes(String(v.until)) &&
    ['active', 'paused', 'ended'].includes(String(v.status)) &&
    text(v.reason) &&
    time(v.nextAt) &&
    time(v.expiresAt) &&
    (v.lastAt === null || time(v.lastAt)) &&
    Number.isInteger(v.failures) &&
    Number(v.failures) >= 0 &&
    isRecord(v.baseline) &&
    Object.keys(v.baseline).length <= 200 &&
    Object.entries(v.baseline).every(([k, s]) => text(k, 300) && text(s, 80))
  )
}
/** 损坏的设置不能降级为空数据后写回。 */
export function isLocalEfficiencyState(v: unknown): v is LocalEfficiencyState {
  return (
    isRecord(v) &&
    hasExactKeys(v, [
      'schemaVersion',
      'autoBackup',
      'lastBackupAt',
      'lastBackupAttemptAt',
      'backupError',
      'browserNotifications',
      'showApplicationName',
      'follows',
      'notices',
    ]) &&
    v.schemaVersion === 1 &&
    typeof v.autoBackup === 'boolean' &&
    (v.lastBackupAt === null || time(v.lastBackupAt)) &&
    (v.lastBackupAttemptAt === null || time(v.lastBackupAttemptAt)) &&
    (v.backupError === null || text(v.backupError)) &&
    typeof v.browserNotifications === 'boolean' &&
    typeof v.showApplicationName === 'boolean' &&
    Array.isArray(v.follows) &&
    v.follows.length <= 100 &&
    v.follows.every(isLocalFollow) &&
    new Set(v.follows.map((x) => x.id)).size === v.follows.length &&
    Array.isArray(v.notices) &&
    v.notices.length <= 300 &&
    v.notices.every(isLocalNotice) &&
    new Set(v.notices.map((x) => x.id)).size === v.notices.length &&
    new Set(v.notices.map((x) => x.eventKey)).size === v.notices.length
  )
}
/** 校验公开备份列表。 */
export function isLocalBackup(v: unknown): v is LocalBackup {
  return (
    isRecord(v) &&
    hasExactKeys(v, ['id', 'createdAt', 'automatic', 'sizeBytes', 'files']) &&
    isPlanId(v.id) &&
    time(v.createdAt) &&
    typeof v.automatic === 'boolean' &&
    Number.isSafeInteger(v.sizeBytes) &&
    Number(v.sizeBytes) >= 0 &&
    Number.isSafeInteger(v.files) &&
    Number(v.files) >= 0
  )
}
/** 确认前核对预览结构，摘要不等同于备份来源认证。 */
export function isRestorePreview(v: unknown): v is RestorePreview {
  return (
    isRecord(v) &&
    hasExactKeys(v, [
      'id',
      'digest',
      'createdAt',
      'sourceCreatedAt',
      'currentFiles',
      'restoredFiles',
      'sameInstallation',
      'artifactRecords',
      'credentialAccounts',
    ]) &&
    isPlanId(v.id) &&
    typeof v.digest === 'string' &&
    /^[a-f0-9]{64}$/.test(v.digest) &&
    time(v.createdAt) &&
    time(v.sourceCreatedAt) &&
    Number.isSafeInteger(v.currentFiles) &&
    Number.isSafeInteger(v.restoredFiles) &&
    typeof v.sameInstallation === 'boolean' &&
    Number.isSafeInteger(v.artifactRecords) &&
    Number(v.artifactRecords) >= 0 &&
    Number.isSafeInteger(v.credentialAccounts) &&
    Number(v.credentialAccounts) >= 0
  )
}
/** 页面响应完整校验后才展示。 */
export function isLocalEfficiencyView(v: unknown): v is LocalEfficiencyView {
  return (
    isRecord(v) &&
    hasExactKeys(v, ['state', 'backups', 'restarting', 'recoveryReadOnly']) &&
    isLocalEfficiencyState(v.state) &&
    Array.isArray(v.backups) &&
    v.backups.every(isLocalBackup) &&
    typeof v.restarting === 'boolean' &&
    typeof v.recoveryReadOnly === 'boolean'
  )
}

/** 恢复前保护事实的安全摘要；不返回产物路径、凭据引用或执行授权。 */
export interface RecoveryProtection {
  id: string
  kind: 'attempt' | 'apple'
  digest: string
  applicationName: string
  channel: string
  appId: string
  versionName: string
  buildNumber: string
  unknown: boolean
  decision: 'present' | 'absent' | null
}
/** 安全账本摘要逐项验证后展示，人工核对不能更改原回执。 */
export function isRecoveryProtection(v: unknown): v is RecoveryProtection {
  return (
    isRecord(v) &&
    hasExactKeys(v, [
      'id',
      'kind',
      'digest',
      'applicationName',
      'channel',
      'appId',
      'versionName',
      'buildNumber',
      'unknown',
      'decision',
    ]) &&
    isPlanId(v.id) &&
    (v.kind === 'attempt' || v.kind === 'apple') &&
    typeof v.digest === 'string' &&
    /^[a-f0-9]{64}$/.test(v.digest) &&
    [v.applicationName, v.channel, v.appId, v.versionName, v.buildNumber].every((x) =>
      text(x, 300),
    ) &&
    typeof v.unknown === 'boolean' &&
    (v.decision === null || v.decision === 'present' || v.decision === 'absent')
  )
}
