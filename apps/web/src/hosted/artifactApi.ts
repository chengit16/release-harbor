/** @description 在线产物同源接口及限定分片直传；签名地址不进入持久化状态。 */
import {
  hostedArtifactLimits,
  isHostedArtifact,
  isRecord,
  type HostedArtifact,
  type HostedArtifactList,
} from '@release-harbor/contracts'
import { json, request } from '../api/client.ts'

/** 解码应用安装包与空间配额；对象存储连接细节不在列表中。 */
export function decodeHostedArtifacts(value: unknown): HostedArtifactList {
  if (
    !isRecord(value) ||
    !Array.isArray(value.items) ||
    !value.items.every(isHostedArtifact) ||
    typeof value.enabled !== 'boolean' ||
    typeof value.reservedBytes !== 'number' ||
    !Number.isSafeInteger(value.reservedBytes) ||
    value.reservedBytes < 0
  )
    throw new Error('在线安装包列表格式不正确')
  return { items: value.items, enabled: value.enabled, reservedBytes: value.reservedBytes }
}

/** 解码服务端接收事实，拒绝非当前合同的状态。 */
export function decodeHostedArtifact(value: unknown): HostedArtifact {
  if (!isHostedArtifact(value)) throw new Error('在线安装包记录格式不正确')
  return value
}

/** 读取固定 HTTPS 签发地址；真正允许的来源仍由服务端 CSP 约束。 */
export function decodeArtifactLink(value: unknown): string {
  if (!isRecord(value) || typeof value.url !== 'string') throw new Error('对象地址格式不正确')
  const url = new URL(value.url)
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('对象地址格式不正确')
  return url.href
}

/** 读取对象存储已核对的分片号。 */
export function decodeCompletedParts(value: unknown): number[] {
  if (
    !isRecord(value) ||
    !Array.isArray(value.completedParts) ||
    !value.completedParts.every(
      (part: unknown): part is number =>
        typeof part === 'number' &&
        Number.isInteger(part) &&
        part >= 1 &&
        part <= hostedArtifactLimits.maxBytes / hostedArtifactLimits.partBytes,
    )
  )
    throw new Error('安装包分片进度格式不正确')
  return value.completedParts
}

/** 只发送小体积 JSON；服务端可能需要完成多次有界对象核对。 */
export function hostedArtifactAction<T>(
  path: string,
  body: unknown,
  decode: (value: unknown) => T,
  signal?: AbortSignal,
): Promise<T> {
  const init = json('POST', body, signal)
  const headers = new Headers(init.headers)
  headers.set('X-Release-Harbor-Hosted', '1')
  return request('/api/hosted' + path, decode, { ...init, headers, cache: 'no-store' }, 35000)
}

/** 由浏览器直接写入一个固定 Blob；不发送会话 Cookie，不重定向或自动重试。 */
export async function uploadHostedPart(
  url: string,
  part: Blob,
  checksum: string,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(url, {
    method: 'PUT',
    body: part,
    headers: { 'x-amz-checksum-sha256': checksum },
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    signal,
  })
  if (!response.ok) throw new Error('对象存储未接收此分片，可继续上传重试')
}
