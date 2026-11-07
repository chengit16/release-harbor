/** @description 指定 Apple 版本的资料完整性投影；只公开有限检查结论，不传联系人、密码、网址或审核原文。 */
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

/** 固定键集避免将原始供应商属性顺带返回控制面。 */
export interface StoreMaterialReport {
  checks: Record<keyof typeof storeMaterialLabels, keyof typeof storeMaterialStates>
}

/** 隐私和完整合规当前未接入，不能伪装为已检查。 */
export function isStoreMaterialReport(value: unknown): value is StoreMaterialReport {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['checks']) &&
    isRecord(value.checks) &&
    hasExactKeys(value.checks, Object.keys(storeMaterialLabels)) &&
    Object.values(value.checks).every(
      (state) => typeof state === 'string' && Object.hasOwn(storeMaterialStates, state),
    ) &&
    value.checks.privacy === 'unchecked' &&
    value.checks.compliance === 'unchecked'
  )
}
