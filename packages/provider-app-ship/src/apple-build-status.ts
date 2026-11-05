/** @description Apple 构建的受限只读核对；JWT 只在可信进程内生成，结果仅投影固定状态。 */
import { createPrivateKey, sign } from 'node:crypto'
import { isRecord, type ReleasePlan, type AttemptResult } from '@release-harbor/contracts'

/** 上传后只核对本应用、营销版本及构建号；空列表或查询失败不撤销已收到的上传回执。 */
export async function observeAppleBuild(
  plan: ReleasePlan,
  keyId: string,
  issuer: string,
  privateKey: string,
  transport: typeof fetch = fetch,
): Promise<AttemptResult | 'processing_failed'> {
  const identity = plan.snapshot.artifact.identity
  if (!identity) return 'build_uploaded'
  const encode = (v: unknown): string => Buffer.from(JSON.stringify(v)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const content = `${encode({ alg: 'ES256', kid: keyId, typ: 'JWT' })}.${encode({ iss: issuer, iat: now, exp: now + 120, aud: 'appstoreconnect-v1' })}`
  const jwt = `${content}.${sign('sha256', Buffer.from(content), { key: createPrivateKey(privateKey), dsaEncoding: 'ieee-p1363' }).toString('base64url')}`
  const url = new URL('https://api.appstoreconnect.apple.com/v1/builds')
  url.search = new URLSearchParams({
    'filter[app]': plan.snapshot.binding.appId,
    'filter[version]': identity.buildNumber,
    'filter[preReleaseVersion.version]': identity.versionName,
    'filter[preReleaseVersion.platform]': 'IOS',
    include: 'preReleaseVersion',
    limit: '2',
  }).toString()
  try {
    const response = await transport(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${jwt}` },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok || !response.body) return 'build_uploaded'
    // 流式限额，避免不可信响应经 JSON 解析造成无界内存使用。
    const chunks: Uint8Array[] = []
    let size = 0
    const reader = response.body.getReader()
    while (true) {
      const next = await reader.read()
      if (next.done) break
      const chunk = next.value
      size += chunk.byteLength
      if (size > 256 * 1024) {
        await reader.cancel()
        return 'build_uploaded'
      }
      chunks.push(chunk)
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (
      !isRecord(body) ||
      !Array.isArray(body.data) ||
      body.data.length !== 1 ||
      !Array.isArray(body.included)
    )
      return 'build_uploaded'
    const build: unknown = body.data[0]
    if (
      !isRecord(build) ||
      build.type !== 'builds' ||
      !isRecord(build.attributes) ||
      build.attributes.version !== identity.buildNumber ||
      !isRecord(build.relationships)
    )
      return 'build_uploaded'
    const version = build.relationships.preReleaseVersion
    if (!isRecord(version) || !isRecord(version.data)) return 'build_uploaded'
    const versionId = version.data.id
    const related = body.included.find(
      (v: unknown) => isRecord(v) && v.type === 'preReleaseVersions' && v.id === versionId,
    )
    if (
      !isRecord(related) ||
      !isRecord(related.attributes) ||
      related.attributes.version !== identity.versionName ||
      related.attributes.platform !== 'IOS'
    )
      return 'build_uploaded'
    switch (build.attributes.processingState) {
      case 'VALID':
        return 'build_available'
      case 'PROCESSING':
        return 'build_processing'
      case 'FAILED':
      case 'INVALID':
        return 'processing_failed'
      default:
        return 'build_uploaded'
    }
  } catch {
    return 'build_uploaded'
  }
}
