/** @description API 与 Vite 共用的可选 HTTPS 隧道配置，只读取一项部署值，不修改进程环境。 */
import { readFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { parseEnv } from 'node:util'

/** 精确匹配浏览器 Origin 和代理保留的原始 Host，不接受通配或转发头。 */
export type WorkbenchTunnel = Readonly<{ origin: string; host: string; hostname: string }>

const key = 'RELEASE_HARBOR_TUNNEL_ORIGIN'

/** 环境变量优先于仓库根目录 .env；留空关闭隧道，非法地址拒绝启动。 */
export function readWorkbenchTunnel(): WorkbenchTunnel | undefined {
  const value = (process.env[key] ?? savedOrigin())?.trim()
  if (!value) return
  const url = URL.parse(value)
  // 使用浏览器序列化后的来源，避免路径、通配、凭据或易混淆的地址被当作授权配置。
  if (
    !url ||
    url.protocol !== 'https:' ||
    (value !== url.origin && value !== url.origin + '/') ||
    isIP(url.hostname) ||
    url.hostname.endsWith('.localhost') ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
      url.hostname,
    )
  )
    throw new Error(`${key} 必须是精确的 HTTPS 域名地址，例如 https://releases.example.com`)
  return { origin: url.origin, host: url.host, hostname: url.hostname }
}

function savedOrigin(): string | undefined {
  try {
    return parseEnv(readFileSync(new URL('../.env', import.meta.url), 'utf8'))[key]
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
    throw error
  }
}
