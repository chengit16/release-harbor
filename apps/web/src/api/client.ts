/** @description 同源 JSON 请求边界，统一错误、超时与运行时解码，不维护页面状态。 */
import { isRecord } from '@release-harbor/contracts'

/** 保留稳定 HTTP 状态供冲突恢复使用，不暴露服务端内部对象。 */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message)
  }
}

/** 请求成功后仍执行解码；取消只停止本地等待，不承诺撤销服务端写入。 */
export async function request<T>(
  path: string,
  decode: (value: unknown) => T,
  init?: RequestInit,
  timeoutMs = 15000,
): Promise<T> {
  const signal = init?.signal
    ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs)
  const response = await fetch(path, { ...init, signal })
  // 团队业务会话失效时卸载页面，避免继续显示先前账号已经读取的状态。
  if (
    typeof window !== 'undefined' &&
    response.status === 401 &&
    path.startsWith('/api/') &&
    !path.startsWith('/api/team/')
  )
    window.dispatchEvent(new Event('release-harbor-session-expired'))
  const result: unknown = await response.json().catch(() => {
    // HTTP服务器或代理可能直接返回空正文／HTML；保留状态，避免解析错误掩盖真正的连接失败。
    if (!response.ok) {
      const reason =
        response.status === 408 || response.status === 504 ? '请求超时' : '服务连接异常'
      throw new HttpError(
        `${reason}（HTTP ${response.status}），请刷新记录核对处理结果`,
        response.status,
      )
    }
    throw new Error('服务响应无法解析，请刷新后重试')
  })
  if (!response.ok)
    throw new HttpError(
      isRecord(result) && typeof result.message === 'string'
        ? result.message
        : '请求未完成，请稍后重试',
      response.status,
    )
  return decode(result)
}

/** 统一校验单项响应，禁止用类型断言替代传输检查。 */
export function item<T>(key: string, guard: (value: unknown) => value is T): (value: unknown) => T {
  return (value) => {
    if (!isRecord(value) || !guard(value[key])) throw new Error('服务响应格式不正确')
    return value[key]
  }
}

/** 列表每项均需通过合同守卫，失败时不展示部分可信数据。 */
export function items<T>(guard: (value: unknown) => value is T): (value: unknown) => T[] {
  return (value) => {
    if (!isRecord(value) || !Array.isArray(value.items) || !value.items.every(guard))
      throw new Error('服务列表格式不正确')
    return value.items
  }
}

/** 只为公开 JSON 输入生成请求配置。 */
export function json(method: string, body: unknown, signal?: AbortSignal): RequestInit {
  return {
    method,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    signal,
  }
}
