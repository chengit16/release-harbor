/** @description 从小米已公开上架详情复用资料；固定官方来源、有界读取且不跟随重定向，不访问隐私政策网站。 */
import { createHash } from 'node:crypto'
import { validateXiaomiUpdateDetails } from '@release-harbor/domain'
import type { XiaomiUpdateDetails } from '@release-harbor/contracts'

async function bytes(response: Response, limit: number): Promise<Buffer> {
  if (!response.ok || !response.body) throw new Error('公开资料不可用')
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.length
      if (size > limit) {
        await reader.cancel()
        throw new Error('资料超限')
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks)
}
function decoded(text: string): string {
  const value = text
    .replace(/&(#x[a-f0-9]+|#\d+|amp|quot|apos|lt|gt);/gi, (_raw, entity: string) => {
      const names: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' }
      if (!entity.startsWith('#')) return names[entity.toLowerCase()] ?? ''
      const code = entity.toLowerCase().startsWith('#x')
        ? parseInt(entity.slice(2), 16)
        : parseInt(entity.slice(1), 10)
      return String.fromCodePoint(code)
    })
    .trim()
  if (/&(?:#\w+|\w+);/.test(value)) throw new Error('资料编码不可识别')
  return value
}
/** 仅查询公开在架版本；不请求开发者更新许可，不下载图标，不据此判断新包审核。 */
export async function loadXiaomiPublicVersion(
  identifier: string,
  transport: typeof fetch = fetch,
): Promise<string> {
  if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(identifier))
    throw new Error('invalid_response')
  const response = await transport(
    'https://app.mi.com/details?id=' + encodeURIComponent(identifier),
    {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    },
  )
  const html = (await bytes(response, 512 * 1024)).toString('utf8')
  const packageName = html.match(
    /包名[\s\S]{0,400}?<div[^>]*class=["']line-break["'][^>]*>\s*([^<]+)/,
  )?.[1]
  const name = html.match(/版本号\s*<\/div>\s*<div\b[^>]*>\s*([^<]+)<\/div>/)?.[1]
  if (!packageName || decoded(packageName) !== identifier || !name)
    throw new Error('invalid_response')
  const value = decoded(name)
  if (!value || value.length > 255 || /[\x00-\x1f]/.test(value)) throw new Error('invalid_response')
  return value
}
/** 只有包名、认证查询名称均匹配才能复用；解析不完整直接失败，不从本地别名或占位图补值。 */
export async function loadXiaomiListing(
  identifier: string,
  appName: string,
  transport: typeof fetch = fetch,
): Promise<XiaomiUpdateDetails> {
  if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(identifier))
    throw new Error('包名不正确')
  const url = 'https://app.mi.com/details?id=' + encodeURIComponent(identifier)
  // 1. 仅抓取固定官方公开页，不把凭据、签名或测试账号发给公开网站。
  const response = await transport(url, {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  })
  const html = (await bytes(response, 512 * 1024)).toString('utf8')
  const name = html.match(
    /<div\s+class=["']intro-titles["'][^>]*>\s*<h3\b[^>]*>([^<]+)<\/h3>/i,
  )?.[1]
  const packageName = html.match(
    /包名[\s\S]{0,400}?<div[^>]*class=["']line-break["'][^>]*>\s*([^<]+)/,
  )?.[1]
  const privacy = html.match(/隐私政策[\s\S]{0,800}?<a\b[^>]*href=["']([^"']+)["']/)?.[1]
  const image = html.match(
    /<div\s+class=["']app-info["'][^>]*>\s*<img\b[^>]*src=["']([^"']+)["']/i,
  )?.[1]
  if (
    !name ||
    !packageName ||
    !privacy ||
    !image ||
    decoded(name) !== appName ||
    decoded(packageName) !== identifier
  )
    throw new Error('商店资料不匹配')
  // 2. 只允许已观察到的官方图标格式，转到同一官方 CDN 的原图入口；拒绝任意地址及远端重定向。
  const imageUrl = new URL(decoded(image))
  const hash = imageUrl.pathname.match(/^\/thumbnail\/PNG\/l\d{1,4}\/AppStore\/([a-f0-9]+)$/i)?.[1]
  if (
    !hash ||
    imageUrl.hostname !== 'file.market.xiaomi.com' ||
    !['http:', 'https:'].includes(imageUrl.protocol) ||
    imageUrl.port ||
    imageUrl.username ||
    imageUrl.password ||
    imageUrl.search ||
    imageUrl.hash
  )
    throw new Error('图标来源不支持')
  const icon = await bytes(
    await transport('https://file.market.xiaomi.com/download/AppStore/' + hash, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    }),
    256 * 1024,
  )
  // 3. 固定真实取回字节与来源时间，后续执行只使用快照，不重新下载替换已确认图标。
  return validateXiaomiUpdateDetails({
    appName,
    privacyUrl: decoded(privacy),
    iconBase64: icon.toString('base64'),
    iconSha256: createHash('sha256').update(icon).digest('hex'),
    source: { kind: 'xiaomi_public_listing', url, checkedAt: new Date().toISOString() },
  })
}
