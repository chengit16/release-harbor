/** @description 魅族与荣耀的只读目标核对，所有 Token／详情只留在可信进程，投影固定安全来源。 */
import type { CredentialProfileStore } from '@huoye/app-ship'
import type { MerchantCheck } from './credentials.ts'
import { meizuTarget } from './meizu-material.ts'
import { honorTarget } from './honor-material.ts'
import { StoreRequestError, storeSession } from './store-client.ts'

/** 只读会话不含任何上传、绑定或送审请求。 */
export async function checkStoreUpdate(
  channel: 'meizu' | 'honor',
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
    const session = await storeSession(channel, material.fields, transport)
    authentication = 'passed'
    const source =
      channel === 'meizu'
        ? { meizu: (await meizuTarget(session, identifier, appId, transport)).summary }
        : { honor: (await honorTarget(session, identifier, appId, transport)).summary }
    return { code: 'verified', authentication, target: 'passed', ...source }
  } catch (error) {
    const codes: Partial<Record<StoreRequestError['diagnostic'], MerchantCheck['code']>> = {
      store_authentication: 'invalid_credentials',
      store_target_mismatch: 'application_mismatch',
      store_target_not_ready: 'application_not_ready',
      meizu_not_on_shelf: 'meizu_not_on_shelf',
      meizu_pending_changes: 'meizu_pending_changes',
      meizu_recommendation_missing: 'meizu_recommendation_missing',
      store_source_invalid: 'store_source_invalid',
      store_rate_limited: 'query_rate_limited',
      store_request_rejected: 'rejected',
      upload_invalid_response: 'invalid_response',
    }
    return {
      code:
        error instanceof StoreRequestError
          ? (codes[error.diagnostic] ?? 'network_unavailable')
          : 'credentials_unavailable',
      authentication,
      target: 'unverified',
    }
  }
}
