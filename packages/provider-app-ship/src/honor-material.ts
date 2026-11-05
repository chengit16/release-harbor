/** @description 荣耀普通应用只读来源及私人审核材料投影；拒绝在审／待发布目标，不输出完整详情。 */
import {
  isRecord,
  isStoreId,
  isHonorLanguage,
  isHonorUpdateDetails,
  type HonorUpdateDetails,
} from '@release-harbor/contracts'
import { StoreRequestError, storeScalar, storeRequest, type StoreSession } from './store-client.ts'

/** 只接入已全网上架且当前申请与上架构建一致的应用，其他状态由后台先处理。 */
export async function honorTarget(
  session: StoreSession,
  identifier: string,
  appId: string,
  transport: typeof fetch,
): Promise<{ summary: HonorUpdateDetails; privateFields: Record<string, unknown> }> {
  // 1. 包名列表精确匹配且唯一，不能只相信浏览器填写的 App ID。
  const ids = (
    await storeRequest(session, 'ids', { pkgName: identifier }, undefined, undefined, transport)
  ).data
  if (!Array.isArray(ids) || ids.length > 10 || !ids.every(isRecord))
    throw new StoreRequestError('store_source_invalid')
  const matches = ids.filter((x) => x.packageName === identifier)
  if (matches.length !== 1 || storeScalar(matches[0]?.appId) !== appId)
    throw new StoreRequestError('store_target_mismatch')
  const detail = (await storeRequest(session, 'detail', { appId }, undefined, undefined, transport))
    .data
  if (
    !isRecord(detail) ||
    !isRecord(detail.basicInfo) ||
    !isRecord(detail.releaseInfo) ||
    !isRecord(detail.publishInfo) ||
    !Array.isArray(detail.languageInfo)
  )
    throw new StoreRequestError('store_source_invalid')
  const basic = detail.basicInfo,
    publish = detail.publishInfo
  if (storeScalar(basic.appId) !== appId || basic.packageName !== identifier)
    throw new StoreRequestError('store_target_mismatch')
  if (
    basic.appCategoryId !== 2 ||
    !(
      publish.releaseType === 1 ||
      (publish.releaseType === 2 &&
        typeof publish.releaseTime === 'string' &&
        Number.isFinite(Date.parse(publish.releaseTime)) &&
        Date.parse(publish.releaseTime) <= Date.now())
    )
  )
    throw new StoreRequestError('store_target_not_ready')
  // 2. 当前流程不能是另一个版本或草稿，避免覆盖用户正在维护的后台记录。
  const current = (
    await storeRequest(session, 'current', { appId }, undefined, undefined, transport)
  ).data
  if (
    !isRecord(current) ||
    current.auditResult !== 1 ||
    (Object.hasOwn(current, 'appId') && storeScalar(current.appId) !== appId) ||
    !isStoreId(storeScalar(detail.releaseInfo.versionCode)) ||
    storeScalar(current.versionCode) !== storeScalar(detail.releaseInfo.versionCode) ||
    current.versionName !== detail.releaseInfo.versionName
  )
    throw new StoreRequestError('store_target_not_ready')
  const languages = detail.languageInfo
    .map((l) => {
      if (!isRecord(l)) throw new StoreRequestError('store_source_invalid')
      const item = {
        languageId: l.languageId,
        appName: l.appName,
        intro: l.intro,
        ...(typeof l.briefIntro === 'string' ? { briefIntro: l.briefIntro } : {}),
        ...(typeof l.newFeature === 'string' ? { newFeature: l.newFeature } : {}),
      }
      if (!isHonorLanguage(item)) throw new StoreRequestError('store_source_invalid')
      return item
    })
    .sort((a, b) => a.languageId.localeCompare(b.languageId))
  const summary = {
    sourceReleaseId: storeScalar(current.releaseId),
    sourceVersionCode: storeScalar(detail.releaseInfo.versionCode),
    defaultLanguage: basic.defaultLanguage,
    releaseCountry: basic.releaseCountry,
    languages,
  }
  if (!isHonorUpdateDetails(summary)) throw new StoreRequestError('store_source_invalid')
  // 3. 只在内存复用白名单私人字段，尤其不得将 basicInfo.secretKey 传播或参与摘要。
  const privateFields: Record<string, unknown> = {}
  if (publish.forceUpdate !== 0 && publish.forceUpdate !== 1)
    throw new StoreRequestError('store_source_invalid')
  privateFields.forceUpdate = publish.forceUpdate
  for (const key of ['testAccount', 'testPassword', 'testComment']) {
    const value = publish[key]
    if (value === undefined || value === null || value === '') continue
    if (
      typeof value !== 'string' ||
      value.length > (key === 'testComment' ? 500 : 4096) ||
      /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)
    )
      throw new StoreRequestError('store_source_invalid')
    privateFields[key] = value
  }
  if (Boolean(privateFields.testAccount) !== Boolean(privateFields.testPassword))
    throw new StoreRequestError('store_source_invalid')
  return { summary, privateFields }
}
