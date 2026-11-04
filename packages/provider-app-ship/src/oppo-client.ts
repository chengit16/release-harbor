/** @description OPPO 固定鉴权／业务端点及安全响应读取；只由可信 provider 使用，不记录 URL、签名或供应商正文。 */
import { createHmac } from 'node:crypto'
import { isRecord, type ExecutionDiagnostic } from '@release-harbor/contracts'

/** 固定平台错误分类，原始异常不跨进程。 */
export class OppoRequestError extends Error {
  constructor(readonly diagnostic: ExecutionDiagnostic) {
    super('OPPO 请求未完成')
  }
}
/** 可信材料仅在本进程持有，不能导入公共合同。 */
export interface OppoSession {
  token: string
  secret: string
}
const base = 'https://oop-openapi-cn.heytapmobi.com'
/** 官方要求先对原值 ASCII 排序拼接，再 HMAC-SHA256，编码在签名之后进行。 */
export function oppoSignature(params: Record<string, string>, secret: string): string {
  return createHmac('sha256', secret)
    .update(
      Object.keys(params)
        .sort()
        .map((k) => `${k}=${params[k]}`)
        .join('&'),
    )
    .digest('hex')
}
/** 仅允许平台返回的 HTTPS 上传入口，不向任意服务器传文件或一次性 sign。 */
export function isOppoUploadUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 8192) return false
  try {
    const u = new URL(value)
    return (
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      !u.hash &&
      !u.port &&
      [
        'heytapmobi.com',
        'oppomobile.com',
        'heytapimage.com',
        'heytapdownload.com',
        'oppo.com',
      ].some((h) => u.hostname === h || u.hostname.endsWith('.' + h))
    )
  } catch {
    return false
  }
}
/** 网络分类只读固定属性，不输出原始异常中的材料、URL 或路径。 */
function networkDiagnostic(error: unknown, signal: AbortSignal): ExecutionDiagnostic {
  const reason: unknown = signal.aborted ? signal.reason : error
  const name = isRecord(reason) ? reason.name : undefined
  const cause = isRecord(reason) && isRecord(reason.cause) ? reason.cause.code : undefined
  if (
    name === 'TimeoutError' ||
    [
      'ETIMEDOUT',
      'UND_ERR_CONNECT_TIMEOUT',
      'UND_ERR_HEADERS_TIMEOUT',
      'UND_ERR_BODY_TIMEOUT',
    ].includes(typeof cause === 'string' ? cause : '')
  )
    return 'upload_timeout'
  return name === 'AbortError' ? 'upload_aborted' : 'upload_network_error'
}
/** 有界流式读取，HTTP、JSON 和业务异常分别投影，不保留供应商错误正文。 */
export async function oppoJson(
  url: string,
  init: RequestInit,
  transport: typeof fetch,
  timeout = 15000,
): Promise<Record<string, unknown>> {
  const signal = AbortSignal.timeout(timeout)
  try {
    // 1. 每次请求都有期限且拒绝重定向，上传配置不得改变认证端点。
    const response = await transport(url, { ...init, redirect: 'error', signal })
    if (!response.ok) throw new OppoRequestError('upload_http_error')
    if (!response.body) throw new OppoRequestError('upload_invalid_response')
    // 2. 流式预算限制响应体，避免错误页面或超大正文进入内存。
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > 512 * 1024) {
          await reader.cancel()
          throw new OppoRequestError('upload_invalid_response')
        }
        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }
    // 3. 只返回成功结构，非成功响应原文不得进入异常或日志。
    let data: unknown
    try {
      data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      throw new OppoRequestError('upload_invalid_response')
    }
    if (!isRecord(data) || !Number.isInteger(data.errno))
      throw new OppoRequestError('upload_invalid_response')
    if (data.errno !== 0) throw new OppoRequestError('oppo_request_rejected')
    if (!isRecord(data.data)) throw new OppoRequestError('upload_invalid_response')
    return data.data
  } catch (error) {
    if (error instanceof OppoRequestError) throw error
    throw new OppoRequestError(networkDiagnostic(error, signal))
  }
}
/** 每次执行只获取自己的短期 token；不刷新或改变其他账号，不缓存进公开状态。 */
export async function oppoSession(
  fields: Record<string, string>,
  transport: typeof fetch,
): Promise<OppoSession> {
  if (!fields.clientId || !fields.clientSecret)
    throw new OppoRequestError('merchant_authentication')
  const data = await oppoJson(
    base +
      '/developer/v1/token?' +
      new URLSearchParams({ client_id: fields.clientId, client_secret: fields.clientSecret }),
    { method: 'GET' },
    transport,
  )
  if (
    typeof data.access_token !== 'string' ||
    !data.access_token ||
    data.access_token.length > 8192
  )
    throw new OppoRequestError('merchant_authentication')
  return { token: data.access_token, secret: fields.clientSecret }
}
/** 业务路由由适配器固定，调用方不能替换域名或传递任意 HTTP 路径。 */
export async function oppoRequest(
  route: 'info' | 'upload' | 'submit' | 'task',
  session: OppoSession,
  params: Record<string, string>,
  transport: typeof fetch,
): Promise<Record<string, unknown>> {
  const paths = {
    info: '/resource/v1/app/info',
    upload: '/resource/v1/upload/get-upload-url',
    submit: '/resource/v1/app/upd',
    task: '/resource/v1/app/task-state',
  }
  const values = {
    ...params,
    access_token: session.token,
    timestamp: String(Math.floor(Date.now() / 1000)),
  }
  const body = new URLSearchParams({ ...values, api_sign: oppoSignature(values, session.secret) })
  const post = route === 'submit' || route === 'task'
  return oppoJson(
    base + paths[route] + (post ? '' : '?' + body),
    post
      ? { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body }
      : { method: 'GET' },
    transport,
    30000,
  )
}
