/** @description 商店可读资料的完整性投影；只公开有限检查结论，不传联系人、密码、网址或审核原文。 */
import { isRecord } from './applications.ts'
import { hasExactKeys } from './release-plans.ts'

/** 每项只证明已读取字段，不替代商店的送审与合规校验。 */
export const storeMaterialLabels = {
  build: '构建关联',
  description: '各语言版本描述',
  support_url: '各语言支持网址',
  screenshots: '各语言截图',
  review_contact: '审核联系人',
  demo_access: '测试登录资料',
  privacy: '隐私资料',
  compliance: '评级、加密与其他合规',
} as const

/** 读取失败或超出检查范围使用 unknown；未接入材料明确 unchecked。 */
export const storeMaterialStates = {
  present: '已填写',
  missing: '待补齐',
  not_required: '无需填写',
  unknown: '未确认',
  unchecked: '未检查',
} as const

/** 独立字段只证明对应材料已填写；完整隐私及合规仍保留未检查。 */
export const storeMaterialExtraLabels = {
  name: '应用名称',
  icon: '应用图标',
  privacy_policy: '隐私政策网址',
  age_rating: '年龄分级声明',
  encryption: '构建加密声明',
} as const

/** 固定键集避免将原始供应商属性顺带返回控制面。 */
export interface StoreMaterialReport {
  checks: Record<keyof typeof storeMaterialLabels, keyof typeof storeMaterialStates>
  /** 新报告按已核实能力追加字段；旧报告缺省，不回填检查结论。 */
  extraChecks?: Partial<
    Record<keyof typeof storeMaterialExtraLabels, keyof typeof storeMaterialStates>
  >
}

/** 完整隐私、审核标签与综合合规仍未接入，不能伪装为已检查。 */
export function isStoreMaterialReport(value: unknown): value is StoreMaterialReport {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'checks',
      ...(Object.hasOwn(value, 'extraChecks') ? ['extraChecks'] : []),
    ]) &&
    isRecord(value.checks) &&
    hasExactKeys(value.checks, Object.keys(storeMaterialLabels)) &&
    Object.values(value.checks).every(
      (state) => typeof state === 'string' && Object.hasOwn(storeMaterialStates, state),
    ) &&
    value.checks.privacy === 'unchecked' &&
    value.checks.compliance === 'unchecked' &&
    (!Object.hasOwn(value, 'extraChecks') ||
      (isRecord(value.extraChecks) &&
        Object.entries(value.extraChecks).every(
          ([key, state]) =>
            Object.hasOwn(storeMaterialExtraLabels, key) &&
            typeof state === 'string' &&
            Object.hasOwn(storeMaterialStates, state),
        )))
  )
}

/** 拒绝原因仅公开固定分类，禁止带出商店原文、私人材料或附件。 */
export const storeRejectionLabels = {
  privacy: '隐私与权限',
  functionality: '功能与运行',
  listing: '名称、文案与截图',
  qualification: '资质与备案',
  policy: '内容与平台规则',
} as const

/** 分类是原文关键词提示，不是完整审核意见；缺原文与无法分类分别表达。 */
export interface StoreRejectionSummary {
  availability: 'categorized' | 'unclassified' | 'not_provided'
  categories: (keyof typeof storeRejectionLabels)[]
}

/** 精确有限合同阻止原始拒绝文字与附件跨越可信执行边界。 */
export function isStoreRejectionSummary(value: unknown): value is StoreRejectionSummary {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['availability', 'categories']) &&
    ['categorized', 'unclassified', 'not_provided'].includes(String(value.availability)) &&
    Array.isArray(value.categories) &&
    value.categories.length <= 5 &&
    new Set(value.categories).size === value.categories.length &&
    value.categories.every(
      (item) => typeof item === 'string' && Object.hasOwn(storeRejectionLabels, item),
    ) &&
    (value.availability === 'categorized'
      ? value.categories.length > 0
      : value.categories.length === 0)
  )
}
