/** @description 两家渠道的只读来源校验及安全投影，完整商店资料不离开可信进程。 */
import { createHash } from 'node:crypto'
import type { CredentialProfileStore } from '@huoye/app-ship'
import {
  isRecord,
  isTencentUpdateDetails,
  isHarmonyUpdateDetails,
  type TencentUpdateDetails,
  type HarmonyUpdateDetails,
} from '@release-harbor/contracts'
import type { MerchantCheck } from './credentials.ts'
import { StoreRequestError, storeScalar } from './store-client.ts'
import {
  tencentRequest,
  harmonyRequest,
  harmonySession,
  type HarmonySession,
} from './tencent-harmony-client.ts'
function digest(v: unknown): string {
  return createHash('sha256').update(JSON.stringify(v)).digest('hex')
}
/** 应用宝签名查询同时绑定 App ID 和包名，只更新已上架的普通软件；不复用旧包流水。 */
export async function tencentTarget(
  fields: Record<string, string>,
  identifier: string,
  appId: string,
  transport: typeof fetch = fetch,
): Promise<TencentUpdateDetails> {
  const r = await tencentRequest(
    fields,
    'query_app_detail',
    { pkg_name: identifier, app_id: appId },
    transport,
  )
  if (r.pkg_name !== identifier) throw new StoreRequestError('store_target_mismatch')
  if (r.app_type !== 1) throw new StoreRequestError('store_target_not_ready')
  const publicFields = {
    appName: r.app_name,
    sourceVersionName: r.VersionName,
    sourceVersionCode: storeScalar(r.VersionCode),
  }
  const summary = { ...publicFields, publicDigest: digest(publicFields) }
  if (!isTencentUpdateDetails(summary)) throw new StoreRequestError('store_source_invalid')
  return summary
}
/** Harmony 类型过滤值 7 与独立 App ID 一起核对，不能把华为 Android 目标当成鸿蒙应用。 */
export async function harmonyTarget(
  session: HarmonySession,
  identifier: string,
  appId: string,
  transport: typeof fetch = fetch,
): Promise<HarmonyUpdateDetails> {
  const ids = await harmonyRequest(
    session,
    'ids',
    { packageName: identifier, packageTypes: '7' },
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
  const r = await harmonyRequest(
      session,
      'info',
      { appId, releaseType: '1' },
      undefined,
      transport,
    ),
    a = r.appInfo
  if (
    !isRecord(a) ||
    a.releaseState !== 0 ||
    (a.releasePhase !== undefined && a.releasePhase !== 0)
  )
    throw new StoreRequestError('store_target_not_ready')
  if (!Array.isArray(r.languages) || !r.languages.every(isRecord))
    throw new StoreRequestError('store_source_invalid')
  const languages = r.languages.filter((l) => l.lang === a.defaultLang)
  if (languages.length !== 1) throw new StoreRequestError('store_source_invalid')
  const publicFields = {
    appName: languages[0]?.appName,
    sourceVersionName: a.versionNumber,
    sourceVersionCode: storeScalar(a.versionCode),
    defaultLang: a.defaultLang,
  }
  const summary = { ...publicFields, publicDigest: digest(publicFields) }
  if (!isHarmonyUpdateDetails(summary)) throw new StoreRequestError('store_source_invalid')
  return summary
}
/** 成功资料只在鉴权及目标均通过时返回；错误正文、测试账号和联系人不会进入预检。 */
export async function checkFinalChannel(
  channel: 'tencent' | 'harmony',
  reference: string,
  identifier: string,
  appId: string,
  store: CredentialProfileStore,
  transport: typeof fetch = fetch,
): Promise<MerchantCheck> {
  let authentication: MerchantCheck['authentication'] = 'unverified'
  try {
    const material = await store.resolveForLocalExecution({
      credentialProfile: reference,
      platform: channel,
      purpose: 'verify',
    })
    if (channel === 'tencent') {
      const tencent = await tencentTarget(material.fields, identifier, appId, transport)
      return { code: 'verified', authentication: 'passed', target: 'passed', tencent }
    }
    const session = await harmonySession(material.fields, transport)
    authentication = 'passed'
    const harmony = await harmonyTarget(session, identifier, appId, transport)
    return { code: 'verified', authentication, target: 'passed', harmony }
  } catch (e) {
    const codes: Partial<Record<StoreRequestError['diagnostic'], MerchantCheck['code']>> = {
      store_authentication: 'invalid_credentials',
      store_target_mismatch: 'application_mismatch',
      store_target_not_ready: 'application_not_ready',
      store_source_invalid: 'store_source_invalid',
      store_request_rejected: 'rejected',
      upload_invalid_response: 'invalid_response',
    }
    return {
      code:
        e instanceof StoreRequestError
          ? (codes[e.diagnostic] ?? 'network_unavailable')
          : 'credentials_unavailable',
      authentication,
      target: 'unverified',
    }
  }
}
