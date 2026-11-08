/** @description 本机维护与配置复用合同；仅含安全摘要，不包含路径、秘密、安装包或授权。 */
import { isRecord } from './applications.ts'
import { hasExactKeys, isPlanId } from './release-plans.ts'

/** 清理只移除原文件，引用数用于提示；历史记录及发布保护始终保留。 */
export interface StoredArtifact {
  id: string
  projectId: string
  applicationId: string
  applicationName: string
  fileName: string
  version: string
  createdAt: string
  status: string
  sizeBytes: number
  references: number
}
/** 容量以实际字节统计，预算与磁盘可用空间分别表达。 */
export interface LocalStorageView {
  usedBytes: number
  budgetBytes: number
  availableBytes: number
  backupBytes: number
  artifacts: StoredArtifact[]
}
/** 检查结果是本机就绪状态，不能证明远端权限或审核成功。 */
export interface RuntimeCheck {
  key: string
  label: string
  state: 'ready' | 'attention' | 'unavailable'
  detail: string
}
/** 不保存绝对发布时间；应用后用户重新选择包、时间并准备确认。 */
export interface ReusableEntry {
  bindingId: string
  releaseNotes: string
  mode: 'after_approval' | 'manual' | 'scheduled'
  huaweiAction: 'save_draft' | 'submit_review'
}
/** 模板和历史均只投影配置；历史不可删除，模板可显式删除。 */
export interface ReleasePreset {
  id: string
  projectId: string
  applicationId: string
  name: string
  kind: 'single' | 'batch'
  source: 'template' | 'history'
  createdAt: string
  entries: ReusableEntry[]
}
const text = (v: unknown, max: number): v is string =>
  typeof v === 'string' &&
  v.length > 0 &&
  v.length <= max &&
  !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v)
/** 所有复用输入使用字段白名单，旧授权、账号与产物不能进入模板。 */
export function isReusableEntry(v: unknown): v is ReusableEntry {
  return (
    isRecord(v) &&
    hasExactKeys(v, ['bindingId', 'releaseNotes', 'mode', 'huaweiAction']) &&
    isPlanId(v.bindingId) &&
    text(v.releaseNotes, 4000) &&
    ['after_approval', 'manual', 'scheduled'].includes(String(v.mode)) &&
    ['save_draft', 'submit_review'].includes(String(v.huaweiAction))
  )
}
/** 目录和磁盘模板共用严格守卫，拒绝跨应用混合配置。 */
export function isReleasePreset(v: unknown): v is ReleasePreset {
  return (
    isRecord(v) &&
    hasExactKeys(v, [
      'id',
      'projectId',
      'applicationId',
      'name',
      'kind',
      'source',
      'createdAt',
      'entries',
    ]) &&
    [v.id, v.projectId, v.applicationId].every(isPlanId) &&
    text(v.name, 80) &&
    ['single', 'batch'].includes(String(v.kind)) &&
    ['template', 'history'].includes(String(v.source)) &&
    typeof v.createdAt === 'string' &&
    Number.isFinite(Date.parse(v.createdAt)) &&
    Array.isArray(v.entries) &&
    v.entries.length > 0 &&
    v.entries.length <= 7 &&
    v.entries.every(isReusableEntry) &&
    new Set(v.entries.map((e) => e.bindingId)).size === v.entries.length &&
    (v.kind !== 'single' || v.entries.length === 1) &&
    (v.kind !== 'batch' ||
      v.entries.every((e) => e.mode !== 'manual' && e.huaweiAction === 'save_draft'))
  )
}
/** 维护目录不接受路径或不安全数字。 */
export function isLocalStorageView(v: unknown): v is LocalStorageView {
  return (
    isRecord(v) &&
    hasExactKeys(v, ['usedBytes', 'budgetBytes', 'availableBytes', 'backupBytes', 'artifacts']) &&
    [v.usedBytes, v.budgetBytes, v.availableBytes, v.backupBytes].every(
      (n) => Number.isSafeInteger(n) && Number(n) >= 0,
    ) &&
    Array.isArray(v.artifacts) &&
    v.artifacts.every(
      (a) =>
        isRecord(a) &&
        hasExactKeys(a, [
          'id',
          'projectId',
          'applicationId',
          'applicationName',
          'fileName',
          'version',
          'createdAt',
          'status',
          'sizeBytes',
          'references',
        ]) &&
        [a.id, a.projectId, a.applicationId].every(isPlanId) &&
        [a.applicationName, a.fileName, a.version, a.createdAt, a.status].every((s) =>
          text(s, 600),
        ) &&
        [a.sizeBytes, a.references].every((n) => Number.isSafeInteger(n) && Number(n) >= 0),
    )
  )
}
/** 诊断只能返回有限状态和安全文字，不透传工具输出。 */
export function isRuntimeCheck(v: unknown): v is RuntimeCheck {
  return (
    isRecord(v) &&
    hasExactKeys(v, ['key', 'label', 'state', 'detail']) &&
    text(v.key, 80) &&
    text(v.label, 120) &&
    ['ready', 'attention', 'unavailable'].includes(String(v.state)) &&
    text(v.detail, 600)
  )
}
