/** @description 应用宝与鸿蒙固定网关：凭据只在可信进程签名，不重定向、不重试写入、不传播平台正文。 */
import { createHmac } from 'node:crypto'
import { isRecord } from '@release-harbor/contracts'
import { readStoreJson, StoreRequestError } from './store-client.ts'

/** 按 ASCII 键序对原始参数签名，URL 编码只能在签名完成之后进行。 */
export function tencentSignature(params: Record<string, string>, secret: string): string {
  return createHmac('sha256', secret)
    .update(
      Object.keys(params)
        .sort()
        .map((k) => `${k}=${params[k]}`)
        .join('&'),
    )
    .digest('hex')
}
/** 固定业务路由不接受配置 URL；所有参数逐次重签，未知业务码不猜测为成功。 */
export async function tencentRequest(
  fields: Record<string, string>,
  route: 'query_app_detail' | 'get_file_upload_info' | 'update_app' | 'query_app_update_status',
  business: Record<string, string>,
  transport: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  if (!fields.userId || !fields.accessSecret) throw new StoreRequestError('store_authentication')
  const params = {
    ...business,
    user_id: fields.userId,
    timestamp: String(Math.floor(Date.now() / 1000)),
  }
  const result = await readStoreJson(
    `https://p.open.qq.com/open_file/developer_api/${route}`,
    {
      method: 'POST',
      body: new URLSearchParams({ ...params, sign: tencentSignature(params, fields.accessSecret) }),
    },
    transport,
  )
  if (result.ret !== 0) {
    // 官方固定错误字典只投影操作建议，不输出 msg 或账号关联信息。
    const code = result.ret
    if (typeof code !== 'number' || !Number.isSafeInteger(code))
      throw new StoreRequestError('upload_invalid_response')
    if ([1000004, 1000012, 1000019, 1000020].includes(code))
      throw new StoreRequestError('store_authentication')
    if ([1000008, 1000009, 3000002, 3000003].includes(code))
      throw new StoreRequestError('store_target_mismatch')
    if ([1000010, 1000011].includes(code)) throw new StoreRequestError('store_target_not_ready')
    if ([4000015, 4000016, 4000038, 4000039].includes(code))
      throw new StoreRequestError('store_release_time_invalid')
    if ([4000040, 4000041, 4000044, 4000045, 4000046, 4000051, 4000052].includes(code))
      throw new StoreRequestError('store_version_invalid')
    throw new StoreRequestError('store_request_rejected')
  }
  return result
}
/** Token 仅存在于本次独立检查／执行，不缓存到控制面。 */
export interface HarmonySession {
  clientId: string
  token: string
}
/** API 客户端只请求固定 Token 端点，禁止 OAuth 信息进入 URL 或日志。 */
export async function harmonySession(
  fields: Record<string, string>,
  transport: typeof fetch = fetch,
): Promise<HarmonySession> {
  if (!fields.clientId || !fields.clientSecret) throw new StoreRequestError('store_authentication')
  const result = await readStoreJson(
    'https://connect-api.cloud.huawei.com/api/oauth2/v1/token',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: fields.clientId,
        client_secret: fields.clientSecret,
      }),
    },
    transport,
  )
  if (
    typeof result.access_token !== 'string' ||
    !result.access_token ||
    result.access_token.length > 8192 ||
    /[\x00-\x20\x7f]/.test(result.access_token)
  )
    throw new StoreRequestError('store_authentication')
  return { clientId: fields.clientId, token: result.access_token }
}
const harmonyRoutes = {
  ids: ['GET', '/v2/appid-list'],
  info: ['GET', '/v3/app-info'],
  androidInfo: ['GET', '/v2/app-info'],
  androidUploadUrl: ['GET', '/v2/upload-url/for-obs'],
  androidFileInfo: ['PUT', '/v2/app-file-info'],
  androidLanguage: ['PUT', '/v2/app-language-info'],
  androidSubmit: ['POST', '/v2/app-submit'],
  init: ['POST', '/v2/upload/multipart/init'],
  parts: ['POST', '/v2/upload/multipart/parts'],
  compose: ['POST', '/v2/upload/multipart/compose'],
  bind: ['PUT', '/v3/app-package-info'],
  compile: ['GET', '/v3/package/compile/status'],
  parsed: ['GET', '/v2/app-package-info'],
  notes: ['PUT', '/v3/app-language-info'],
  submit: ['POST', '/v3/app-submit'],
} as const
/** 读／写固定方法由路由表决定，软件包查询的 appId 按官方要求使用 header。 */
export async function harmonyRequest(
  session: HarmonySession,
  route: keyof typeof harmonyRoutes,
  query: Record<string, string>,
  body: unknown = undefined,
  transport: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  const [method, path] = harmonyRoutes[route],
    url = new URL('https://connect-api.cloud.huawei.com/api/publish' + path)
  const headers: Record<string, string> = {
    Authorization: `Bearer ${session.token}`,
    client_id: session.clientId,
    'content-type': 'application/json',
  }
  for (const [k, v] of Object.entries(query)) {
    if (route === 'parsed' && k === 'appId') headers.appId = v
    else url.searchParams.set(k, v)
  }
  const result = await readStoreJson(
    url.href,
    { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
    transport,
  )
  let ret: unknown = result.ret
  if (typeof ret === 'string') {
    try {
      ret = JSON.parse(ret)
    } catch {
      throw new StoreRequestError('upload_invalid_response')
    }
  }
  if (!isRecord(ret) || (ret.code !== 0 && ret.code !== '0'))
    throw new StoreRequestError(
      isRecord(ret) ? 'store_request_rejected' : 'upload_invalid_response',
    )
  return result
}
/** 签名存储地址限定官方 HTTPS 域名，不允许用户配置地址、重定向或内网 IP。 */
export function isFinalUploadUrl(value: unknown, channel: 'tencent' | 'harmony'): value is string {
  if (typeof value !== 'string' || value.length > 16384) return false
  try {
    const u = new URL(value)
    return (
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      !u.hash &&
      !u.port &&
      (channel === 'tencent'
        ? /^[a-z0-9-]+\.cos\.[a-z0-9-]+\.myqcloud\.com$/.test(u.hostname)
        : /^[a-z0-9.-]+\.obs\.[a-z0-9-]+\.(myhuaweicloud\.com|huaweicloud\.com)$/.test(u.hostname))
    )
  } catch {
    return false
  }
}
/** 文件请求不带开发者凭据；只使用平台签发的存储头，失败后不自动重传。 */
export async function putFinalFile(
  url: string,
  body: Blob,
  headers: Record<string, string>,
  transport: typeof fetch = fetch,
): Promise<Response> {
  const signal = AbortSignal.timeout(300000)
  try {
    const r = await transport(url, { method: 'PUT', body, headers, signal, redirect: 'error' })
    if (!r.ok) {
      await r.body?.cancel()
      throw new StoreRequestError('upload_http_error')
    }
    return r
  } catch (e) {
    if (e instanceof StoreRequestError) throw e
    throw new StoreRequestError(signal.aborted ? 'upload_timeout' : 'upload_network_error')
  }
}
