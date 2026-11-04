/** @description OPPO 已有普通应用的公开资料快照；排除测试说明、联系人、密钥和原始商店响应。 */
import { isRecord } from './applications.ts'

/** 自动复用的必需公开字段，技术名称沿用平台接口以避免映射歧义。 */
export const oppoRequiredFields = [
  'second_category_id',
  'third_category_id',
  'summary',
  'detail_desc',
  'privacy_source_url',
  'icon_url',
  'pic_url',
  'copyright_url',
  'age_level',
  'adaptive_equipment',
] as const
/** 仅透传已存在的公开资质或展示配置，不构造虚假默认值。 */
export const oppoOptionalFields = [
  'landscape_pic_url',
  'electronic_cert_url',
  'icp_url',
  'special_url',
  'special_file_url',
  'adaptive_type',
] as const
/** 数据来自指定商店版本；秘密审核材料只由可信执行器即时复用。 */
export interface OppoUpdateDetails {
  appName: string
  sourceVersionId: string
  sourceVersionCode: string
  fields: Partial<
    Record<(typeof oppoRequiredFields)[number] | (typeof oppoOptionalFields)[number], string>
  >
}
/** 只校验可公开传输的资料，不能替代商店鉴权及当前状态核对。 */
export function isOppoUpdateDetails(value: unknown): value is OppoUpdateDetails {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 4 ||
    typeof value.appName !== 'string' ||
    !value.appName.trim() ||
    value.appName.length > 100 ||
    typeof value.sourceVersionId !== 'string' ||
    !/^\d{1,32}$/.test(value.sourceVersionId) ||
    typeof value.sourceVersionCode !== 'string' ||
    !/^\d{1,18}$/.test(value.sourceVersionCode) ||
    !isRecord(value.fields)
  )
    return false
  const fields = value.fields
  return (
    oppoRequiredFields.every((k) => typeof fields[k] === 'string' && Boolean(fields[k])) &&
    Object.entries(fields).every(
      ([k, v]) =>
        [...oppoRequiredFields, ...oppoOptionalFields].some((key) => key === k) &&
        typeof v === 'string' &&
        v.length <= 16000 &&
        !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v),
    ) &&
    !/[\x00-\x1f\x7f]/.test(value.appName) &&
    JSON.stringify(fields).length <= 48000
  )
}

/** 来源及所有公开复用字段必须一致，不能将另一份资料冒充本次预检来源。 */
export function sameOppoUpdateDetails(a: OppoUpdateDetails, b: OppoUpdateDetails): boolean {
  return (
    a.appName === b.appName &&
    a.sourceVersionId === b.sourceVersionId &&
    a.sourceVersionCode === b.sourceVersionCode &&
    [...oppoRequiredFields, ...oppoOptionalFields].every((k) => a.fields[k] === b.fields[k])
  )
}
