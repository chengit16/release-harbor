/** @description 魅族与荣耀更新的公开来源，只含版本及公开展示资料；私人备案和审核材料留在执行器。 */
import { isRecord } from './applications.ts'

/** 魅族版本锚点及公开资料摘要，摘要不计算联系人、证件、测试账号或密钥。 */
export interface MeizuUpdateDetails {
  sourceVersionId: string
  sourceVersionName: string
  appName: string
  publicDigest: string
}
/** 荣耀默认语种更新说明只修改对应项，其他语种和语言字段保持现有内容。 */
export interface HonorLanguage {
  languageId: string
  appName: string
  intro: string
  briefIntro?: string
  newFeature?: string
}
/** 已全网上架版本及允许复用的语言资料，不包含 basicInfo.secretKey 或 publishInfo 私人字段。 */
export interface HonorUpdateDetails {
  sourceReleaseId: string
  sourceVersionCode: string
  defaultLanguage: string
  releaseCountry: string
  languages: HonorLanguage[]
}
/** 平台 Long 标识只接受十进制；数字形式由可信 adapter 检查安全整数后转换。 */
export function isStoreId(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value)
}
/** 发布流程 ID 是平台字符串，不套用 Long 的纯数字范围。 */
export function isStoreReceiptId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
}
/** 无控制字符的公开单行，避免文件、错误和秘密字段混入标识。 */
function text(value: unknown, max: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= max &&
    !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)
  )
}
/** 来源结构严格限制字段；历史读取不重新解释或补填资料。 */
export function isMeizuUpdateDetails(value: unknown): value is MeizuUpdateDetails {
  return (
    isRecord(value) &&
    Object.keys(value).length === 4 &&
    isStoreId(value.sourceVersionId) &&
    text(value.sourceVersionName, 100) &&
    text(value.appName, 100) &&
    typeof value.publicDigest === 'string' &&
    /^[a-f0-9]{64}$/.test(value.publicDigest)
  )
}
/** 语言信息白名单不接受任意 vendor 字段。 */
export function isHonorLanguage(value: unknown): value is HonorLanguage {
  return (
    isRecord(value) &&
    Object.keys(value).every((k) =>
      ['languageId', 'appName', 'intro', 'briefIntro', 'newFeature'].includes(k),
    ) &&
    typeof value.languageId === 'string' &&
    /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/.test(value.languageId) &&
    text(value.appName, 100) &&
    text(value.intro, 8000) &&
    ['briefIntro', 'newFeature'].every(
      (k) =>
        !Object.hasOwn(value, k) ||
        (typeof value[k] === 'string' &&
          value[k].length <= (k === 'briefIntro' ? 80 : 500) &&
          !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value[k])),
    )
  )
}
/** 只允许完整、唯一且包含默认语种的来源，多语种修改不得扩大为全量替换。 */
export function isHonorUpdateDetails(value: unknown): value is HonorUpdateDetails {
  return (
    isRecord(value) &&
    Object.keys(value).length === 5 &&
    isStoreReceiptId(value.sourceReleaseId) &&
    isStoreId(value.sourceVersionCode) &&
    typeof value.defaultLanguage === 'string' &&
    typeof value.releaseCountry === 'string' &&
    /^(?:[A-Z]{2})(?:\|[A-Z]{2}){0,99}$/.test(value.releaseCountry) &&
    Array.isArray(value.languages) &&
    value.languages.length > 0 &&
    value.languages.length <= 100 &&
    value.languages.every(isHonorLanguage) &&
    new Set(value.languages.map((l) => l.languageId)).size === value.languages.length &&
    value.languages.some((l) => l.languageId === value.defaultLanguage) &&
    JSON.stringify(value).length <= 100000
  )
}
/** 不比较对象键顺序，公开材料和来源都须保持一致。 */
export function sameMeizuUpdateDetails(a: MeizuUpdateDetails, b: MeizuUpdateDetails): boolean {
  return (
    a.sourceVersionId === b.sourceVersionId &&
    a.sourceVersionName === b.sourceVersionName &&
    a.appName === b.appName &&
    a.publicDigest === b.publicDigest
  )
}
/** 语种数组顺序没有业务含义，但任一公开字段变化都使来源失效。 */
export function sameHonorUpdateDetails(a: HonorUpdateDetails, b: HonorUpdateDetails): boolean {
  return (
    a.sourceReleaseId === b.sourceReleaseId &&
    a.sourceVersionCode === b.sourceVersionCode &&
    a.defaultLanguage === b.defaultLanguage &&
    a.releaseCountry === b.releaseCountry &&
    a.languages.length === b.languages.length &&
    a.languages.every((l) => {
      const r = b.languages.find((x) => x.languageId === l.languageId)
      return (
        r &&
        l.appName === r.appName &&
        l.intro === r.intro &&
        l.briefIntro === r.briefIntro &&
        l.newFeature === r.newFeature
      )
    })
  )
}
