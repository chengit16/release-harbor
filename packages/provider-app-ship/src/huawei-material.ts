/** @description 华为 Android 已上架来源读取；仅投影公开版本与默认语言摘要。 */
import { createHash } from 'node:crypto'
import type { CredentialProfileStore } from '@huoye/app-ship'
import {
  isHuaweiUpdateDetails,
  isRecord,
  type HuaweiUpdateDetails,
} from '@release-harbor/contracts'
import { harmonyRequest, harmonySession, type HarmonySession } from './tencent-harmony-client.ts'
import { StoreRequestError, storeScalar } from './store-client.ts'
import type { MerchantCheck } from './credentials.ts'

/** 不把语言文案和隐私资料穿过控制面，只冻结送审需要核对的公开来源字段。 */
export async function huaweiUpdateSource(
  session: HarmonySession,
  identifier: string,
  appId: string,
  transport: typeof fetch = fetch,
): Promise<HuaweiUpdateDetails> {
  // 1. 先按包名核对唯一 App ID，防止使用账号下其他应用的资料。
  const ids = await harmonyRequest(
    session,
    'ids',
    { packageName: identifier },
    undefined,
    transport,
  )
  if (
    !Array.isArray(ids.appids) ||
    ids.appids.length !== 1 ||
    !isRecord(ids.appids[0]) ||
    storeScalar(ids.appids[0].value) !== appId
  )
    throw new StoreRequestError('store_target_mismatch')
  // 2. 首片只更新已上架且没有草稿／在审冲突的全网版本，不覆盖已有编辑。
  const response = await harmonyRequest(
    session,
    'androidInfo',
    { appId, releaseType: '1' },
    undefined,
    transport,
  )
  const app = response.appInfo
  if (
    !isRecord(app) ||
    (Object.hasOwn(app, 'packageName') && app.packageName !== identifier) ||
    (Object.hasOwn(app, 'releaseType') && storeScalar(app.releaseType) !== '1') ||
    storeScalar(app.releaseState) !== '0' ||
    typeof app.publishCountry !== 'string' ||
    !app.publishCountry.trim() ||
    !Array.isArray(response.languages) ||
    !response.languages.every(isRecord)
  )
    throw new StoreRequestError('store_target_not_ready')
  const defaultLang = app.defaultLang,
    currentLanguage = response.languages.filter((language) => language.lang === defaultLang)
  if (currentLanguage.length !== 1 || typeof defaultLang !== 'string')
    throw new StoreRequestError('store_source_invalid')
  const sourceVersionName = storeScalar(app.onShelfVersionNumber),
    sourceVersionCode = storeScalar(app.onShelfVersionCode),
    publicFields = { sourceVersionName, sourceVersionCode, defaultLang },
    // 3. 只对公开语言文案与发行范围计算摘要，审核联系人及登录材料不参与指纹。
    publicDigest = createHash('sha256')
      .update(
        JSON.stringify({
          ...publicFields,
          languages: response.languages.map((language) => ({
            lang: language.lang,
            appName: language.appName,
            appDesc: language.appDesc,
            briefInfo: language.briefInfo,
            newFeatures: language.newFeatures,
          })),
          publishCountry: app.publishCountry,
          privacyPolicy: app.privacyPolicy,
        }),
      )
      .digest('hex'),
    result = { ...publicFields, publicDigest }
  if (!isHuaweiUpdateDetails(result)) throw new StoreRequestError('store_source_invalid')
  // 部分后台编辑不会立即改变应用级状态；若已有不同的当前包，不能用旧在架版本掩盖编辑冲突。
  if (
    (Object.hasOwn(app, 'versionCode') && storeScalar(app.versionCode) !== sourceVersionCode) ||
    (Object.hasOwn(app, 'versionNumber') && storeScalar(app.versionNumber) !== sourceVersionName)
  )
    throw new StoreRequestError('store_target_not_ready')
  return result
}

/** 只读正式更新检查只在送审准备显式调用，不改变既有草稿预检。 */
export async function checkHuaweiUpdate(
  reference: string,
  identifier: string,
  appId: string,
  store: CredentialProfileStore,
  transport?: typeof fetch,
): Promise<MerchantCheck> {
  try {
    const material = await store.resolveForLocalExecution({
      credentialProfile: reference,
      platform: 'huawei',
      purpose: 'verify',
    })
    const huawei = await huaweiUpdateSource(
      await harmonySession(material.fields, transport),
      identifier,
      appId,
      transport,
    )
    return { code: 'verified', authentication: 'passed', target: 'passed', huawei }
  } catch (error) {
    const code = error instanceof StoreRequestError ? error.diagnostic : 'store_authentication'
    return {
      code:
        code === 'store_authentication'
          ? 'invalid_credentials'
          : code === 'store_target_mismatch'
            ? 'application_mismatch'
            : code === 'store_target_not_ready'
              ? 'application_not_ready'
              : code === 'store_source_invalid'
                ? 'store_source_invalid'
                : 'network_unavailable',
      authentication: code === 'store_authentication' ? 'unverified' : 'passed',
      target: 'unverified',
    }
  }
}
