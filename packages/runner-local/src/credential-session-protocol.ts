/** @description 仅本机会话控制协议，包含短期配置能力，禁止放进公开 contracts 或持久化。 */
import { isRecord, isProfileReference, type BindingChannel } from '@release-harbor/contracts'

/** 浏览器仅在向导内存保存该能力，端点由当前受信任子进程分配。 */
export interface CredentialSetupSession {
  id: string
  operationId: string
  reference: string
  channel: BindingChannel
  endpoint: string
  token: string
  expiresAt: string
}

/** 固定回环地址，不能让未知响应诱导浏览器向第三方提交材料。 */
export function isCredentialSetupSession(value: unknown): value is CredentialSetupSession {
  if (!isRecord(value) || Object.keys(value).length !== 7 || typeof value.endpoint !== 'string')
    return false
  let url: URL
  try {
    url = new URL(value.endpoint)
  } catch {
    return false
  }
  return (
    ['id', 'operationId'].every(
      (k) => typeof value[k] === 'string' && /^[a-f0-9-]{36}$/.test(value[k]),
    ) &&
    isProfileReference(value.reference) &&
    (value.channel === 'huawei' ||
      value.channel === 'app_store' ||
      value.channel === 'xiaomi' ||
      value.channel === 'oppo' ||
      value.channel === 'vivo' ||
      value.channel === 'meizu' ||
      value.channel === 'honor') &&
    url.protocol === 'http:' &&
    url.hostname === '127.0.0.1' &&
    Number(url.port) > 0 &&
    url.pathname === '/' &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    value.endpoint === url.origin &&
    typeof value.token === 'string' &&
    /^[a-f0-9]{64}$/.test(value.token) &&
    typeof value.expiresAt === 'string' &&
    Number.isFinite(Date.parse(value.expiresAt))
  )
}
