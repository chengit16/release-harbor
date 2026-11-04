/** @description 小米更新的非秘密公开资料；图标随快照固定，测试账号只能进入本机安全材料。 */
import { isRecord } from './applications.ts'

/** 仅用于已存在应用的单 APK 更新；图标原始 PNG 不超过 256 KiB。 */
export interface XiaomiUpdateDetails {
  /** 明确核对的当前商店名称，执行前与查询结果比对，避免本地别名覆盖商店名称。 */
  appName: string
  /** 自动复用公开上架资料时记录来源；旧人工资料没有此字段。 */
  source?: {
    kind: 'xiaomi_public_listing'
    /** 固定官方公开详情页，不含用户凭据或能力令牌。 */
    url: string
    /** UTC ISO 8601 的实际读取时间，不代表后台草稿更新时间。 */
    checkedAt: string
  }
  /** 公开的 HTTPS 隐私政策地址，不允许账号信息或片段；保留官方公开政策地址的合法查询参数。 */
  privacyUrl: string
  /** 标准 Base64 PNG 内容，不包含 data: 前缀或本机路径。 */
  iconBase64: string
  /** 原始图标字节 SHA-256，由服务端重算，执行时再次核对。 */
  iconSha256: string
}
/** 公开结构守卫；实际字节和 SHA 的权威核对留在可信 Node 边界。 */
export function isXiaomiUpdateDetails(value: unknown): value is XiaomiUpdateDetails {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== (Object.hasOwn(value, 'source') ? 5 : 4) ||
    (Object.hasOwn(value, 'source') &&
      (!isRecord(value.source) ||
        Object.keys(value.source).length !== 3 ||
        value.source.kind !== 'xiaomi_public_listing' ||
        typeof value.source.url !== 'string' ||
        !/^https:\/\/app\.mi\.com\/details\?id=[A-Za-z][A-Za-z0-9_.]*$/.test(value.source.url) ||
        typeof value.source.checkedAt !== 'string' ||
        !Number.isFinite(Date.parse(value.source.checkedAt)) ||
        new Date(value.source.checkedAt).toISOString() !== value.source.checkedAt)) ||
    typeof value.appName !== 'string' ||
    !value.appName.trim() ||
    value.appName !== value.appName.trim() ||
    value.appName.length > 60 ||
    /[\x00-\x1f\x7f]/.test(value.appName) ||
    typeof value.privacyUrl !== 'string' ||
    value.privacyUrl.length > 2048 ||
    typeof value.iconBase64 !== 'string' ||
    value.iconBase64.length > 349528 ||
    !/^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(value.iconBase64) ||
    typeof value.iconSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.iconSha256)
  )
    return false
  try {
    const url = new URL(value.privacyUrl)
    return (
      url.protocol === 'https:' && !url.username && !url.password && !url.hash && !!url.hostname
    )
  } catch {
    return false
  }
}
