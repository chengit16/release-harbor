/** @description 商店资料与拒绝原因的有限投影；原文、URL、联系人和附件只停留于可信进程，不下载外部资源。 */
import {
  storeMaterialLabels,
  type StoreMaterialReport,
  type StoreRejectionSummary,
  type StoreVersionStatus,
} from '@release-harbor/contracts'

type State = StoreMaterialReport['checks']['build']

/** 缺少字段和明确空值分别表达，避免把官方未返回材料误报为必填缺项。 */
export function materialText(value: unknown): State {
  return value === undefined
    ? 'unknown'
    : typeof value === 'string'
      ? value.trim()
        ? 'present'
        : 'missing'
      : value === null
        ? 'missing'
        : 'unknown'
}

/** 只验证网址形式，不打开地址，也不保留其内容；签名资源不会离开进程。 */
export function materialUrl(value: unknown): State {
  if (materialText(value) !== 'present') return materialText(value)
  try {
    const url = new URL(String(value))
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? 'present'
      : 'missing'
  } catch {
    return 'missing'
  }
}

/** 数组或逗号列表只证明存在资源引用，不能证明图片尺寸、内容或可访问性。 */
export function materialImages(value: unknown): State {
  if (value === undefined) return 'unknown'
  const items = typeof value === 'string' ? value.split(',').filter((v) => v.trim()) : value
  if (!Array.isArray(items)) return value === null ? 'missing' : 'unknown'
  if (!items.length) return 'missing'
  return items.every((item) => materialText(item) === 'present') ? 'present' : 'unknown'
}

/** 多语言缺一项即提示缺项；没有完整可读列表时保持未确认。 */
export function materialAggregate(states: State[]): State {
  return !states.length
    ? 'unknown'
    : states.includes('missing')
      ? 'missing'
      : states.every((item) => item === 'present')
        ? 'present'
        : 'unknown'
}

/** 未接入的字段保持未检查，只有调用方提供的已核实字段才覆盖。 */
export function materialReport(
  checks: Partial<StoreMaterialReport['checks']>,
  extraChecks: StoreMaterialReport['extraChecks'] = {},
): StoreMaterialReport {
  const base: StoreMaterialReport['checks'] = {
    build: 'unchecked',
    description: 'unchecked',
    support_url: 'unchecked',
    screenshots: 'unchecked',
    review_contact: 'unchecked',
    demo_access: 'unchecked',
    privacy: 'unchecked',
    compliance: 'unchecked',
  }
  // 固定键的显式构造防止调用方传入商店原属性；完整合规永远不能由单字段证明。
  for (const key of Object.keys(storeMaterialLabels) as (keyof typeof storeMaterialLabels)[]) {
    if (checks[key]) base[key] = checks[key]
  }
  base.privacy = 'unchecked'
  base.compliance = 'unchecked'
  return { checks: base, extraChecks }
}

/** 仅对明确拒绝的同一结果归类；关键词是辅助提示，完整原因仍以后台为准。 */
export function rejectionSummary(
  state: StoreVersionStatus['state'],
  raw: unknown,
): StoreRejectionSummary | undefined {
  if (!['rejected', 'pre_rejected', 'qualification_rejected', 'removal_rejected'].includes(state))
    return undefined
  if (typeof raw !== 'string' || !raw.trim())
    return { availability: 'not_provided', categories: [] }
  const text = raw.slice(0, 16000)
  const patterns = {
    privacy: /隐私|个人信息|权限|privacy|permission/i,
    functionality: /闪退|崩溃|无法运行|无法登录|功能|crash|login|function/i,
    listing: /截图|图标|名称|描述|文案|screenshot|description|icon/i,
    qualification: /资质|备案|版权|版号|证书|营业执照|copyright|certificate/i,
    policy: /违规|违法|内容|政策|policy|content/i,
  }
  const categories = (Object.keys(patterns) as (keyof typeof patterns)[]).filter((key) =>
    patterns[key].test(text),
  )
  return { availability: categories.length ? 'categorized' : 'unclassified', categories }
}
