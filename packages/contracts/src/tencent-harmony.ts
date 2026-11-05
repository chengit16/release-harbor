/** @description 应用宝与鸿蒙的白名单来源；不包含审核账号、签名、上传地址或私人资料。 */
import { isRecord } from './applications.ts'
/** 来源数字版本和公开资料摘要用于执行前比对，不复用旧安装包流水。 */
export interface TencentUpdateDetails {
  appName: string
  sourceVersionName: string
  sourceVersionCode: string
  publicDigest: string
}
/** 鸿蒙目标、来源版本及默认语种；App ID 与 bundleName 分开管理。 */
export interface HarmonyUpdateDetails {
  appName: string
  sourceVersionName: string
  sourceVersionCode: string
  defaultLang: string
  publicDigest: string
}
/** 安全版本号不经浮点转换，防止大整数精度丢失。 */
export function isStoreVersionCode(v: unknown): v is string {
  return typeof v === 'string' && /^[1-9]\d{0,17}$/.test(v)
}
function valid(v: unknown, extra: boolean): boolean {
  return (
    isRecord(v) &&
    Object.keys(v).length === (extra ? 5 : 4) &&
    typeof v.appName === 'string' &&
    v.appName.length > 0 &&
    v.appName.length <= 120 &&
    !/[\x00-\x1f\x7f]/.test(v.appName) &&
    typeof v.sourceVersionName === 'string' &&
    v.sourceVersionName.length > 0 &&
    v.sourceVersionName.length <= 100 &&
    !/[\x00-\x1f\x7f]/.test(v.sourceVersionName) &&
    isStoreVersionCode(v.sourceVersionCode) &&
    typeof v.publicDigest === 'string' &&
    /^[a-f0-9]{64}$/.test(v.publicDigest) &&
    (!extra || (typeof v.defaultLang === 'string' && /^[A-Za-z0-9_-]{1,30}$/.test(v.defaultLang)))
  )
}
/** 限定应用宝来源结构，未知字段拒绝跨控制面。 */
export function isTencentUpdateDetails(v: unknown): v is TencentUpdateDetails {
  return valid(v, false)
}
/** 限定鸿蒙来源结构，私人联系人等不能进入快照。 */
export function isHarmonyUpdateDetails(v: unknown): v is HarmonyUpdateDetails {
  return valid(v, true)
}

/** 来源字段逐项比较，JSON 属性排列顺序不能改变同一事实。 */
export function sameTencentHarmonySource(
  a: TencentUpdateDetails | HarmonyUpdateDetails,
  b: TencentUpdateDetails | HarmonyUpdateDetails,
): boolean {
  return (
    a.appName === b.appName &&
    a.sourceVersionName === b.sourceVersionName &&
    a.sourceVersionCode === b.sourceVersionCode &&
    a.publicDigest === b.publicDigest &&
    ('defaultLang' in a
      ? 'defaultLang' in b && a.defaultLang === b.defaultLang
      : !('defaultLang' in b))
  )
}
