/** @description 版本定位与人工核对合同；用户记录仅为本机事实，不授予发布权限或覆盖官方状态。 */
import { isRecord } from './applications.ts'
import { hasExactKeys, isPlanId } from './release-plans.ts'

/** OPPO 普通包的可选定位；省略表示读取官方默认版本，不能传任意 URL 或商店目标。 */
export interface StoreVersionQuery {
  kind: 'oppo_build'
  buildNumber: string
}

/** 构建号保持十进制字符串，避免数值精度或非规范前导零导致错误匹配。 */
export function isStoreVersionQuery(value: unknown): value is StoreVersionQuery {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['kind', 'buildNumber']) &&
    value.kind === 'oppo_build' &&
    typeof value.buildNumber === 'string' &&
    /^[1-9]\d{0,17}$/.test(value.buildNumber)
  )
}

/** 人工可记录的审核事实；不会自动转换成官方查询或解除结果不明的保护。 */
export const manualReviewStates = {
  draft: '草稿',
  in_review: '审核中',
  rejected: '审核未通过',
  approved: '审核通过',
  published: '已上架',
  withdrawn: '已撤审',
  unknown: '尚无法确认',
} as const

/** 每次保存追加事实；requestId 使网络重试幂等，不覆盖旧记录。 */
export interface StoreManualInput {
  requestId: string
  versionName: string
  buildNumber: string | null
  state: keyof typeof manualReviewStates
  /** 用户实际查看后台的时间，不能晚于保存时间。 */
  checkedAt: string
  /** 仅填写简短处理备注，不粘贴秘密或原始审核材料。 */
  note: string
}

/** 绑定与来源由服务端设置，浏览器不能冒称官方结果。 */
export interface StoreManualRecord extends StoreManualInput {
  bindingId: string
  source: 'local_user'
  createdAt: string
}

function time(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  )
}
function fields(value: Record<string, unknown>): boolean {
  return (
    isPlanId(value.requestId) &&
    typeof value.versionName === 'string' &&
    value.versionName.trim().length > 0 &&
    value.versionName.length <= 80 &&
    !/[\x00-\x1f\x7f]/.test(value.versionName) &&
    (value.buildNumber === null ||
      (typeof value.buildNumber === 'string' && /^[1-9]\d{0,17}$/.test(value.buildNumber))) &&
    typeof value.state === 'string' &&
    Object.hasOwn(manualReviewStates, value.state) &&
    time(value.checkedAt) &&
    typeof value.note === 'string' &&
    value.note.length <= 300 &&
    !/[\x00-\x1f\x7f]/.test(value.note)
  )
}
const inputKeys = ['requestId', 'versionName', 'buildNumber', 'state', 'checkedAt', 'note']

/** 严格拒绝来源、目标或授权覆盖字段。 */
export function isStoreManualInput(value: unknown): value is StoreManualInput {
  return isRecord(value) && hasExactKeys(value, inputKeys) && fields(value)
}

/** 读取人工历史时保留独立来源与时间，不将缺字段的旧数据猜补成官方记录。 */
export function isStoreManualRecord(value: unknown): value is StoreManualRecord {
  return (
    isRecord(value) &&
    hasExactKeys(value, [...inputKeys, 'bindingId', 'source', 'createdAt']) &&
    fields(value) &&
    isPlanId(value.bindingId) &&
    value.source === 'local_user' &&
    time(value.createdAt) &&
    time(value.checkedAt) &&
    Date.parse(value.checkedAt) <= Date.parse(value.createdAt)
  )
}
