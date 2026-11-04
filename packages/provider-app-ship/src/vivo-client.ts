/** @description vivo 正式固定网关、签名及有界安全响应读取；不记录签名、URL 或平台正文，不重试写入。 */
import { createHmac } from 'node:crypto'
import { isRecord, type ExecutionDiagnostic } from '@release-harbor/contracts'

/** 仅公开固定诊断，供应商消息不得进入异常。 */
export class VivoRequestError extends Error {
  constructor(readonly diagnostic: ExecutionDiagnostic) {
    super('vivo 请求未完成')
  }
}
/** ASCII 键序拼接原值，签名后编码；文件、sign 不参与签名。 */
export function vivoSignature(params: Record<string, string>, secret: string): string {
  return createHmac('sha256', secret)
    .update(
      Object.keys(params)
        .sort()
        .map((k) => `${k}=${params[k]}`)
        .join('&'),
    )
    .digest('hex')
}
/** 业务码只映射已知安全分类；不得把平台 msg 原样附到日志。 */
function rejection(code: string, subCode: string): ExecutionDiagnostic {
  if (['10001', '10004', '10007', '10008', '10012', '10018'].includes(code))
    return 'vivo_authentication'
  if (['10006', '10011'].includes(code)) return 'vivo_rate_limited'
  if (subCode === '11001' || subCode === '12002') return 'vivo_target_mismatch'
  if (['12010', '12022', '21001', '21003', '21004'].includes(subCode))
    return 'vivo_target_not_ready'
  if (['15003', '15010', '15012'].includes(subCode)) return 'vivo_version_invalid'
  if (['22009', '22010', '22011'].includes(subCode)) return 'vivo_release_time_invalid'
  if (['20016'].includes(subCode)) return 'vivo_notes_invalid'
  return 'vivo_request_rejected'
}
/** 只允许三个明确方法，HTTP 连接期限、响应预算和拒绝重定向同时生效。 */
export async function vivoRequest(
  method: 'app.query.details' | 'app.upload.apk.app' | 'app.sync.update.app',
  fields: Record<string, string>,
  params: Record<string, string>,
  transport: typeof fetch = fetch,
  file?: Blob,
): Promise<Record<string, unknown>> {
  if (!fields.accessKey || !fields.accessSecret) throw new VivoRequestError('vivo_authentication')
  const values = {
    ...params,
    method,
    access_key: fields.accessKey,
    timestamp: String(Date.now()),
    format: 'json',
    v: '1.0',
    sign_method: 'HMAC-SHA256',
    target_app_key: 'developer',
  }
  const signed = { ...values, sign: vivoSignature(values, fields.accessSecret) }
  const body = file ? new FormData() : new URLSearchParams(signed)
  if (file && body instanceof FormData) {
    for (const [k, v] of Object.entries(signed)) body.set(k, v)
    body.set('file', file, 'payload.apk')
  }
  const signal = AbortSignal.timeout(file ? 300000 : 30000)
  try {
    // 1. 所有认证参数只在请求体，调用方不能指定其他地址或跟随跳转。
    const response = await transport('https://developer-api.vivo.com.cn/router/rest', {
      method: 'POST',
      body,
      signal,
      redirect: 'error',
    })
    if (!response.ok) throw new VivoRequestError('upload_http_error')
    if (!response.body) throw new VivoRequestError('upload_invalid_response')
    // 2. 查询可含较多现有资料，限定读取预算，完成后仅投影必要字段。
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
          throw new VivoRequestError('upload_invalid_response')
        }
        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }
    let data: unknown
    try {
      data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      throw new VivoRequestError('upload_invalid_response')
    }
    // 3. code 必须存在；subCode 官方可省略，有值时必须是十进制码。
    if (
      !isRecord(data) ||
      !/^(0|[1-9]\d{0,7})$/.test(String(data.code)) ||
      !['string', 'number'].includes(typeof data.code) ||
      (Object.hasOwn(data, 'subCode') &&
        (!['string', 'number'].includes(typeof data.subCode) ||
          !/^(0|[1-9]\d{0,7})$/.test(String(data.subCode))))
    )
      throw new VivoRequestError('upload_invalid_response')
    if (String(data.code) !== '0' || (data.subCode !== undefined && String(data.subCode) !== '0'))
      throw new VivoRequestError(rejection(String(data.code), String(data.subCode)))
    if (method === 'app.sync.update.app') return {}
    if (!isRecord(data.data)) throw new VivoRequestError('upload_invalid_response')
    return data.data
  } catch (error) {
    if (error instanceof VivoRequestError) throw error
    const reason: unknown = signal.aborted ? signal.reason : error
    const name = isRecord(reason) ? reason.name : undefined
    throw new VivoRequestError(
      name === 'TimeoutError'
        ? 'upload_timeout'
        : name === 'AbortError'
          ? 'upload_aborted'
          : 'upload_network_error',
    )
  }
}
