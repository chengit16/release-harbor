/** @description 项目问题知识库的纯公开合同；正文仅纯文本，拒绝秘密字段、任意文件路径和未知事实状态。 */
import { isBindingChannel, isRecord } from './applications.ts'
import { hasExactKeys } from './release-plans.ts'

/** 少量稳定主分类，渠道另作标签，不创建重复的组合分类。 */
export const issueCategories = {
  experience: '功能与交互',
  credentials: '账号与鉴权',
  artifacts: '安装包与检查',
  publishing: '渠道与发布',
  engineering: '工程与环境',
} as const
/** 处理状态不替代根因确认程度或商店执行结果。 */
export const issueStatuses = {
  open: '待定位',
  in_progress: '处理中',
  pending_verification: '待验证',
  resolved: '已解决',
  deferred: '暂缓',
} as const
/** 问题性质与影响程度分别表达。 */
export const issueKinds = { bug: '缺陷', improvement: '体验改进', feature: '能力需求' } as const
/** 用于列表排序及详情提示，不根据报错文本自动推测。 */
export const issueSeverities = { high: '高', medium: '中', low: '低' } as const
/** 根因未知的历史问题不会因为相关修复而被回填成已确认。 */
export const causeConfidences = { confirmed: '已确认', suspected: '疑似', unknown: '未知' } as const
/** 仅已执行的方法能作为验证依据。 */
export const issueVerificationMethods = {
  automated: '自动测试',
  browser: '浏览器验收',
  manual_local: '本机人工核对',
  user_feedback: '用户反馈',
} as const
/** 单条经过整理的问题，不包含原始日志、安装包或秘密材料。日期是日历日期，不伪造精确时间。 */
export interface IssueRecord {
  id: string
  title: string
  kind: keyof typeof issueKinds
  category: keyof typeof issueCategories
  channels: ('common' | 'huawei' | 'xiaomi' | 'oppo' | 'app_store')[]
  status: keyof typeof issueStatuses
  severity: keyof typeof issueSeverities
  firstObservedDate: string | null
  updatedDate: string
  symptoms: string
  rootCause: { confidence: keyof typeof causeConfidences; detail: string }
  solution: string
  verification: {
    result: 'passed' | 'pending'
    methods: (keyof typeof issueVerificationMethods)[]
    detail: string
  }
  prevention: string
  evidence: { documents: string[]; commits: string[] }
  relatedIssues: string[]
}
/** 当前发布版本的完整目录，列表与详情共用相同事实来源。 */
export interface IssueCatalog {
  schemaVersion: 1
  updatedDate: string
  items: IssueRecord[]
}
/** 稳定公开编号仅用于定位，不作为写入或文件访问授权。 */
export function isIssueId(value: unknown): value is string {
  return typeof value === 'string' && /^RH-\d{4,8}$/.test(value)
}
function date(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  )
}
function text(value: unknown, limit = 16000): value is string {
  return (
    typeof value === 'string' &&
    !!value.trim() &&
    value.length <= limit &&
    !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)
  )
}
function choice<T extends string>(value: unknown, labels: Record<T, string>): value is T {
  return typeof value === 'string' && Object.hasOwn(labels, value)
}
function unique<T>(values: T[]): boolean {
  return new Set(values).size === values.length
}
/** 只能引用仓库 Markdown 文档，拒绝 URL、绝对路径、编码和路径穿越。 */
export function isIssueDocument(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 240 &&
    /^[A-Za-z0-9_./-]+\.md$/.test(value) &&
    !value.split('/').some((v) => !v || v === '.' || v === '..') &&
    (['README.md', 'CONTEXT.md', 'AGENTS.md'].includes(value) ||
      value.startsWith('docs/') ||
      value.startsWith('openspec/'))
  )
}
/** 严格键集同时保护磁盘与 HTTP 边界，不能把未验证问题当作已解决。 */
export function isIssueRecord(value: unknown): value is IssueRecord {
  // 1. 顶层仅接收可公开的事实字段，日期和标签也需校验。
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'id',
      'title',
      'kind',
      'category',
      'channels',
      'status',
      'severity',
      'firstObservedDate',
      'updatedDate',
      'symptoms',
      'rootCause',
      'solution',
      'verification',
      'prevention',
      'evidence',
      'relatedIssues',
    ]) ||
    !isIssueId(value.id) ||
    !text(value.title, 160) ||
    !choice(value.kind, issueKinds) ||
    !choice(value.category, issueCategories) ||
    !choice(value.status, issueStatuses) ||
    !choice(value.severity, issueSeverities) ||
    !Array.isArray(value.channels) ||
    !value.channels.length ||
    !unique(value.channels) ||
    !value.channels.every((v) => v === 'common' || isBindingChannel(v)) ||
    !(value.firstObservedDate === null || date(value.firstObservedDate)) ||
    !date(value.updatedDate) ||
    (typeof value.firstObservedDate === 'string' && value.firstObservedDate > value.updatedDate) ||
    !text(value.symptoms) ||
    !text(value.solution) ||
    !text(value.prevention)
  )
    return false
  // 2. 事实置信度与验证单独保留，证据只能是限定文档和提交标识。
  const r = value.rootCause,
    v = value.verification,
    e = value.evidence
  return (
    isRecord(r) &&
    hasExactKeys(r, ['confidence', 'detail']) &&
    choice(r.confidence, causeConfidences) &&
    text(r.detail) &&
    isRecord(v) &&
    hasExactKeys(v, ['result', 'methods', 'detail']) &&
    (v.result === 'passed' || v.result === 'pending') &&
    text(v.detail) &&
    Array.isArray(v.methods) &&
    unique(v.methods) &&
    v.methods.every((m) => choice(m, issueVerificationMethods)) &&
    (value.status !== 'resolved' || (v.result === 'passed' && v.methods.length > 0)) &&
    isRecord(e) &&
    hasExactKeys(e, ['documents', 'commits']) &&
    Array.isArray(e.documents) &&
    unique(e.documents) &&
    e.documents.every(isIssueDocument) &&
    Array.isArray(e.commits) &&
    unique(e.commits) &&
    e.commits.every((c) => typeof c === 'string' && /^[a-f0-9]{7,40}$/.test(c)) &&
    Array.isArray(value.relatedIssues) &&
    unique(value.relatedIssues) &&
    value.relatedIssues.every((id) => isIssueId(id) && id !== value.id)
  )
}
/** 目录必须整体可信；重复编号和悬空关联不允许部分展示。 */
export function isIssueCatalog(value: unknown): value is IssueCatalog {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['schemaVersion', 'updatedDate', 'items']) ||
    value.schemaVersion !== 1 ||
    !date(value.updatedDate) ||
    !Array.isArray(value.items) ||
    value.items.length > 1000 ||
    !value.items.every(isIssueRecord)
  )
    return false
  const updatedDate = value.updatedDate
  const ids = new Set(value.items.map((v) => v.id))
  return (
    ids.size === value.items.length &&
    value.items.every(
      (v) => v.updatedDate <= updatedDate && v.relatedIssues.every((id) => ids.has(id)),
    )
  )
}
