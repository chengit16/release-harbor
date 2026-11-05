/** @description Apple 审核的可信网络边界；固定路由、短期 JWT、限额响应、零写重试，错误仅固定码。 */
import { createPrivateKey, sign } from 'node:crypto'
import { isRecord, isAppleResourceId, type AppleReviewCode } from '@release-harbor/contracts'
import type { CredentialResolver } from '@huoye/app-ship'

/** 供应商原始错误只在本模块内丢弃，不附到异常正文。 */
export class AppleReviewError extends Error {
  constructor(readonly code: AppleReviewCode) {
    super(code)
  }
}
/** 固定路由客户端仅由可信 provider 使用，不能从浏览器传入 URL。 */
export interface AppleReviewClient {
  request(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
    query?: Record<string, string>,
  ): Promise<Record<string, unknown>>
  list(path: string, query?: Record<string, string>): Promise<Record<string, unknown>[]>
}
/** 固定资源路径安全编码。 */
export function appleId(v: unknown): string {
  if (!isAppleResourceId(v)) throw new AppleReviewError('target')
  return v
}
/** 解密材料仅在 worker 内签发短期 JWT，不返回材料或请求头。 */
export async function appleReviewClient(
  store: CredentialResolver,
  reference: string,
  transport: typeof fetch = fetch,
): Promise<AppleReviewClient> {
  let jwt: string
  try {
    const m = await store.resolveForLocalExecution({
      credentialProfile: reference,
      platform: 'app_store',
      purpose: 'release_execution',
    })
    const key = m.fields.apiKeyId,
      issuer = m.fields.apiIssuerId,
      content = m.files?.privateKey?.content
    if (
      !key ||
      !/^[A-Z0-9]{10}$/.test(key) ||
      !issuer ||
      !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(issuer) ||
      !content ||
      Buffer.byteLength(content) > 64 * 1024
    )
      throw Error()
    const privateKey = createPrivateKey(content)
    if (
      privateKey.asymmetricKeyType !== 'ec' ||
      privateKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1'
    )
      throw Error()
    const now = Math.floor(Date.now() / 1000),
      encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
    const base = `${encode({ alg: 'ES256', kid: key, typ: 'JWT' })}.${encode({ iss: issuer, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' })}`
    jwt = `${base}.${sign('sha256', Buffer.from(base), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`
  } catch {
    throw new AppleReviewError('credentials')
  }
  async function request(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
    query?: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const allowed =
      method === 'GET'
        ? /^\/v1\/(apps\/[\w-]+(?:\/(?:builds|appStoreVersions|reviewSubmissions))?|builds\/[\w-]+\/(?:app|preReleaseVersion)|appStoreVersions\/[\w-]+\/(?:build|appStoreVersionLocalizations|appStoreReviewDetail)|appStoreVersionLocalizations\/[\w-]+\/appScreenshotSets|appScreenshotSets\/[\w-]+\/appScreenshots|reviewSubmissions\/[\w-]+\/items)$/
        : method === 'PATCH'
          ? /^\/v1\/(?:appStoreVersions|appStoreVersionLocalizations|reviewSubmissions)\/[\w-]+$/
          : /^\/v1\/(?:reviewSubmissions|reviewSubmissionItems|appStoreVersionReleaseRequests)$/
    if (!allowed.test(path)) throw new AppleReviewError('target')
    const url = new URL(path, 'https://api.appstoreconnect.apple.com')
    if (query) url.search = new URLSearchParams(query).toString()
    try {
      const r = await transport(url, {
        method,
        headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error',
        signal: AbortSignal.timeout(20000),
      })
      if (!r.ok)
        throw new AppleReviewError(
          [401, 403].includes(r.status) ? 'credentials' : r.status === 404 ? 'target' : 'rejected',
        )
      if (!r.body) throw new AppleReviewError('receipt')
      const reader = r.body.getReader(),
        chunks: Uint8Array[] = []
      let size = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > 1024 * 1024) {
          await reader.cancel()
          throw new AppleReviewError('receipt')
        }
        chunks.push(value)
      }
      const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (!isRecord(parsed)) throw new AppleReviewError('receipt')
      return parsed
    } catch (e) {
      if (e instanceof AppleReviewError) throw e
      throw new AppleReviewError('network')
    }
  }
  async function list(
    path: string,
    query: Record<string, string> = {},
  ): Promise<Record<string, unknown>[]> {
    // 不跟随上游任意 next URL；本轮最多 200 条，超限明确失败，不将截断目录当成完整。
    const body = await request('GET', path, undefined, { ...query, limit: '200' })
    if (
      !Array.isArray(body.data) ||
      !body.data.every(isRecord) ||
      body.data.length > 200 ||
      (isRecord(body.links) && body.links.next)
    )
      throw new AppleReviewError('receipt')
    return body.data
  }
  return { request, list }
}
