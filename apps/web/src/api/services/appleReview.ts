/** @description Apple 审核控制面安全请求；不接收秘密、工具路径或供应商 URL。 */
import {
  isAppleReviewCatalog,
  isAppleReviewRecord,
  type AppleReviewCatalog,
  type AppleReviewRecord,
} from '@release-harbor/contracts'
import { item, items, json, request } from '../client.ts'
/** 公开审核操作端口；所有写入仍由服务端校验范围和来源。 */
export interface AppleReviewApi {
  list(signal: AbortSignal): Promise<AppleReviewRecord[]>
  catalog(bindingId: string, signal: AbortSignal): Promise<AppleReviewCatalog>
  prepare(body: unknown, signal: AbortSignal): Promise<AppleReviewRecord>
  execute(record: AppleReviewRecord, signal: AbortSignal): Promise<AppleReviewRecord>
  reconcile(
    record: AppleReviewRecord,
    body: unknown,
    signal: AbortSignal,
  ): Promise<AppleReviewRecord>
}
/** 页面仅传当前应用归属，服务端重新核对绑定和账号。 */
export function appleReviewApi(project: string, application: string): AppleReviewApi {
  const root = `/api/projects/${encodeURIComponent(project)}/applications/${encodeURIComponent(application)}/apple-review`
  const post = <T>(
    path: string,
    body: unknown,
    decode: (v: unknown) => T,
    signal: AbortSignal,
  ): Promise<T> => {
    const init = json('POST', body, signal)
    return request(
      root + path,
      decode,
      { ...init, headers: { ...init.headers, 'X-Release-Harbor-Plan': '1' } },
      65000,
    )
  }
  return {
    list: (signal: AbortSignal): Promise<AppleReviewRecord[]> =>
      request(root, items(isAppleReviewRecord), { signal }),
    catalog: (bindingId: string, signal: AbortSignal): Promise<AppleReviewCatalog> =>
      post('/catalog', { bindingId }, item('catalog', isAppleReviewCatalog), signal),
    prepare: (body: unknown, signal: AbortSignal): Promise<AppleReviewRecord> =>
      post('/prepare', body, item('record', isAppleReviewRecord), signal),
    execute: (r: AppleReviewRecord, signal: AbortSignal): Promise<AppleReviewRecord> =>
      post(
        `/${encodeURIComponent(r.id)}/execute`,
        { expectedDigest: r.digest, acknowledged: true },
        item('record', isAppleReviewRecord),
        signal,
      ),
    reconcile: (
      r: AppleReviewRecord,
      body: unknown,
      signal: AbortSignal,
    ): Promise<AppleReviewRecord> =>
      post(
        `/${encodeURIComponent(r.id)}/reconcile`,
        { ...(typeof body === 'object' && body), expectedDigest: r.digest },
        item('record', isAppleReviewRecord),
        signal,
      ),
  }
}
