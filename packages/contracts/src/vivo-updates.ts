/** @description vivo 已有普通应用的安全来源；不包含商店测试材料、附件地址或账号秘密。 */
import { isRecord } from './applications.ts'

/** 来源构建号必须递增，兼容设备原样复用，不擅自默认改成手机。 */
export interface VivoUpdateDetails {
  sourceVersionCode: string
  compatibleDevice: '1' | '2' | '3'
}
/** vivo 普通单包接口使用正整数版本号；拒绝精度丢失和扩展字段。 */
export function isVivoVersionCode(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d{0,9}$/.test(value) && BigInt(value) <= 2147483647n
}
/** 仅有两项白名单来源，不能借用此结构携带原始详情或材料。 */
export function isVivoUpdateDetails(value: unknown): value is VivoUpdateDetails {
  return (
    isRecord(value) &&
    Object.keys(value).length === 2 &&
    isVivoVersionCode(value.sourceVersionCode) &&
    ['1', '2', '3'].includes(String(value.compatibleDevice)) &&
    typeof value.compatibleDevice === 'string'
  )
}
/** 执行必须仍是准备时的同一来源版本与设备范围。 */
export function sameVivoUpdateDetails(a: VivoUpdateDetails, b: VivoUpdateDetails): boolean {
  return a.sourceVersionCode === b.sourceVersionCode && a.compatibleDevice === b.compatibleDevice
}
