/** @description 华为 Android 正式更新的公开来源；只保存可核对的版本、语言及摘要。 */
import { isRecord } from './applications.ts'
import { isStoreVersionCode } from './tencent-harmony.ts'

/** 商店已上架来源版本和默认语言，私人审核字段不进入计划快照。 */
export interface HuaweiUpdateDetails {
  sourceVersionName: string
  sourceVersionCode: string
  defaultLang: string
  /** 公开来源文案与发行范围的 SHA-256；不包含私人审核材料。 */
  publicDigest: string
}

/** 送审来源必须有可递增的构建号及有效商店默认语言。 */
export function isHuaweiUpdateDetails(value: unknown): value is HuaweiUpdateDetails {
  return (
    isRecord(value) &&
    Object.keys(value).length === 4 &&
    typeof value.sourceVersionName === 'string' &&
    value.sourceVersionName.length > 0 &&
    value.sourceVersionName.length <= 100 &&
    !/[\x00-\x1f\x7f]/.test(value.sourceVersionName) &&
    isStoreVersionCode(value.sourceVersionCode) &&
    typeof value.defaultLang === 'string' &&
    /^[A-Za-z0-9_-]{1,30}$/.test(value.defaultLang) &&
    typeof value.publicDigest === 'string' &&
    /^[a-f0-9]{64}$/.test(value.publicDigest)
  )
}

/** 执行前逐字段比对，属性顺序不能改变来源事实。 */
export function sameHuaweiUpdateDetails(a: HuaweiUpdateDetails, b: HuaweiUpdateDetails): boolean {
  return (
    a.sourceVersionName === b.sourceVersionName &&
    a.sourceVersionCode === b.sourceVersionCode &&
    a.defaultLang === b.defaultLang &&
    a.publicDigest === b.publicDigest
  )
}
