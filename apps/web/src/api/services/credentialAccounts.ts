/** @description 商店账号安全目录与保存结果查询，只有非秘密元数据使用通用 API Client。 */
import {
  isCredentialAccounts,
  isCredentialAccountResult,
  type CredentialAccountAction,
  type CredentialAccountResult,
  isCredentialOperation,
  type CredentialAccounts,
  type CredentialOperation,
} from '@release-harbor/contracts'
import { item, request } from '../client.ts'

/** 列表不鉴权、不解密，保存后重新读取，不持久化账号缓存。 */
export function listCredentialAccounts(signal: AbortSignal): Promise<CredentialAccounts> {
  return request('/api/credential-accounts', item('catalog', isCredentialAccounts), {
    signal,
    cache: 'no-store',
  })
}

/** 超时只查询既有操作，不自动重发材料；范围由控制面固定为 local。 */
export function getCredentialOperation(
  id: string,
  signal: AbortSignal,
): Promise<CredentialOperation> {
  return request(
    `/api/credential-operations/${encodeURIComponent(id)}`,
    item('operation', isCredentialOperation),
    { signal, cache: 'no-store' },
  )
}

/** 管理请求只含公开资料；不自动重试，超时由目录核对最终状态。 */
export function manageCredentialAccount(
  input: CredentialAccountAction,
  signal: AbortSignal,
): Promise<CredentialAccountResult> {
  return request('/api/credential-account-actions', item('result', isCredentialAccountResult), {
    method: 'POST',
    cache: 'no-store',
    signal,
    headers: { 'Content-Type': 'application/json', 'X-Release-Harbor-Setup': '1' },
    body: JSON.stringify(input),
  })
}
