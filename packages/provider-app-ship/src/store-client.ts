/** @description 魅族／荣耀固定网关及认证通道；有界读取、无重定向、无写重试，不输出 vendor 正文或秘密。 */
import { createHash, randomUUID } from 'node:crypto'
import { isRecord, type ExecutionDiagnostic } from '@release-harbor/contracts'

/** 只允许固定原因跨执行边界，原始平台错误不附加到 message。 */
export class StoreRequestError extends Error {
  constructor(readonly diagnostic: ExecutionDiagnostic) {
    super('商店请求未完成')
  }
}
/** 平台整数或十进制文本归一化；不允许对象、数组及不安全整数转为可信 ID。 */
export function storeScalar(value: unknown): string {
  return typeof value === 'string'
    ? value
    : typeof value === 'number' && Number.isSafeInteger(value)
      ? String(value)
      : ''
}
/** 业务码投影基于官方字典，未识别码保留“拒绝”而不编造详细原因。 */
function diagnostic(channel: 'meizu' | 'honor', code: number): ExecutionDiagnostic {
  const auth =
    channel === 'meizu'
      ? [113033, 113036, 113037, 113038]
      : [10001, 10002, 10003, 10004, 10005, 10006, 10007, 11031]
  if (auth.includes(code)) return 'store_authentication'
  if ([113003, 120006, 120008, 20005, 30001, 30002, 30003, 30007].includes(code))
    return 'store_target_mismatch'
  if ([113021, 113029, 113030, 113032, 30006].includes(code)) return 'store_version_invalid'
  if ([113040, 113042, 113043, 20022, 20023].includes(code)) return 'store_target_not_ready'
  if (code === 30011) return 'store_rate_limited'
  if ([20018, 20019].includes(code)) return 'store_release_time_invalid'
  return 'store_request_rejected'
}
/** 成功正文也限制在 1 MiB，JSON 和网络异常只转成固定安全码。 */
export async function readStoreJson(
  url: string,
  init: RequestInit,
  transport: typeof fetch,
  timeout = 30000,
): Promise<Record<string, unknown>> {
  const signal = AbortSignal.timeout(timeout)
  try {
    // 1. 固定期限与拒绝重定向，HTTP 错误不读取或传播上游正文。
    const r = await transport(url, { ...init, signal, redirect: 'error' })
    if (r.status === 401 || r.status === 403) throw new StoreRequestError('store_authentication')
    if (!r.ok) throw new StoreRequestError('upload_http_error')
    if (!r.body) throw new StoreRequestError('upload_invalid_response')
    // 2. 有界读取完整响应，超预算立即取消，避免异常大正文进入解析。
    const reader = r.body.getReader(),
      chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const p = await reader.read()
        if (p.done) break
        size += p.value.length
        if (size > 1048576) {
          await reader.cancel()
          throw new StoreRequestError('upload_invalid_response')
        }
        chunks.push(p.value)
      }
    } finally {
      reader.releaseLock()
    }
    // 3. JSON 格式与对象边界先验证，业务码由对应平台调用方继续核对。
    let data: unknown
    try {
      data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      throw new StoreRequestError('upload_invalid_response')
    }
    if (!isRecord(data)) throw new StoreRequestError('upload_invalid_response')
    return data
  } catch (error) {
    if (error instanceof StoreRequestError) throw error
    const reason: unknown = signal.aborted ? signal.reason : error,
      name = isRecord(reason) ? reason.name : undefined
    throw new StoreRequestError(
      name === 'TimeoutError'
        ? 'upload_timeout'
        : name === 'AbortError'
          ? 'upload_aborted'
          : 'upload_network_error',
    )
  }
}
/** 魅族签名只覆盖四个官方 header 字段；排序后追加冒号和 Client Secret 再 SHA-256。 */
export function meizuHeaders(
  fields: Record<string, string>,
  token: string,
  uri: string,
  timestamp = String(Date.now()),
  traceId: string = randomUUID(),
): Record<string, string> {
  const params = { traceId, clientId: fields.clientId ?? '', timestamp, uri }
  const sign = createHash('sha256')
    .update(
      Object.entries(params)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => `${k}=${v}`)
        .join('&') +
        ':' +
        fields.clientSecret,
    )
    .digest('hex')
  return { traceId, clientId: params.clientId, timestamp, accessToken: token, sign }
}
/** 每次预检或执行独立会话，不刷新／缓存其他账号 Token。 */
export interface StoreSession {
  channel: 'meizu' | 'honor'
  fields: Record<string, string>
  token: string
}
/** 鉴权仅在可信进程调用；材料不会进入 URL、公开合同或日志。 */
export async function storeSession(
  channel: 'meizu' | 'honor',
  fields: Record<string, string>,
  transport: typeof fetch = fetch,
): Promise<StoreSession> {
  if (!fields.clientId || !fields.clientSecret) throw new StoreRequestError('store_authentication')
  const r = await readStoreJson(
    channel === 'meizu'
      ? 'https://developer.meizu.com/open/api/v1/token'
      : 'https://iam.developer.honor.com/auth/token',
    channel === 'meizu'
      ? { method: 'GET', headers: { clientId: fields.clientId, clientSecret: fields.clientSecret } }
      : {
          method: 'POST',
          body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: fields.clientId,
            client_secret: fields.clientSecret,
          }),
        },
    transport,
  )
  const token =
    channel === 'meizu' && r.code === 200 && isRecord(r.value)
      ? r.value.accessToken
      : channel === 'honor'
        ? r.access_token
        : undefined
  if (typeof token !== 'string' || !token || token.length > 8192 || /[\x00-\x20\x7f]/.test(token))
    throw new StoreRequestError('store_authentication')
  return { channel, fields, token }
}
const routes = {
  meizu: {
    list: '/open/api/v1/app/list',
    detail: '/open/api/v1/app/detail',
    versions: '/open/api/v1/app/versions',
    upload: '/open/api/v1/app/apk/upload',
    submit: '/open/api/v1/app/publish',
  },
  honor: {
    ids: '/openapi/v1/publish/get-app-id',
    detail: '/openapi/v1/publish/get-app-detail',
    current: '/openapi/v1/publish/get-app-current-release',
    prepare: '/openapi/v1/publish/get-file-upload-url',
    upload: '/openapi/v1/publish/file-upload',
    bind: '/openapi/v1/publish/update-file-info',
    language: '/openapi/v1/publish/update-language-info',
    submit: '/openapi/v1/publish/submit-audit',
  },
} as const
/** 固定路由字典拒绝任意路径，返回完整成功 envelope 仅供 provider 内部结构校验。 */
export async function storeRequest(
  session: StoreSession,
  route: keyof typeof routes.meizu | keyof typeof routes.honor,
  query: Record<string, string> = {},
  body?: unknown,
  file?: Blob,
  transport: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  // 1. 业务路由只来自固定字典，不接受任意域名或相对路径。
  const entries: Record<string, string> = routes[session.channel],
    uri = entries[route]
  if (!uri) throw new StoreRequestError('store_submission_validation')
  const url = new URL(
    uri,
    session.channel === 'meizu'
      ? 'https://developer.meizu.com'
      : 'https://appmarket-openapi-drcn.cloud.honor.com',
  )
  Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v))
  const headers: Record<string, string> =
    session.channel === 'meizu'
      ? meizuHeaders(session.fields, session.token, uri)
      : { Authorization: `Bearer ${session.token}` }
  // 2. 认证头与正文在可信进程组装，文件路径不会出现在上传文件名中。
  let payload: BodyInit | undefined
  if (file) {
    const f = new FormData()
    f.set('file', file, 'payload.apk')
    payload = f
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  // 3. 单次请求必须同时取得合法 envelope 与明确业务成功，不自动重试。
  const r = await readStoreJson(
    url.href,
    { method: payload ? 'POST' : 'GET', headers, body: payload },
    transport,
    file ? 300000 : 30000,
  )
  if (typeof r.code !== 'number' || !Number.isSafeInteger(r.code))
    throw new StoreRequestError('upload_invalid_response')
  if (r.code !== (session.channel === 'meizu' ? 200 : 0))
    throw new StoreRequestError(diagnostic(session.channel, r.code))
  return r
}
