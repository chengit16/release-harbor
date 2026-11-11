/** @description 在线运行配置；回调和 Host 固定为配置来源，不从代理头或请求构造。 */
import type { HostedOidcOptions } from './oidc.ts'

const callbackPath = '/api/hosted/auth/callback'

/** 将配置解析为 HTTPS 来源，拒绝路径、凭据或端口歧义。 */
export function hostedOrigin(raw: string): URL {
  const origin = new URL(raw)
  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  )
    throw new Error('在线来源必须是 HTTPS 来源')
  return origin
}

/** 发行者必须是明确的 HTTPS 地址；保留配置值以便精确比对 OIDC issuer。 */
export function configuredIssuer(raw: string): string {
  const url = new URL(raw)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('OIDC 发行者必须是 HTTPS 地址')
  return raw
}

/** 获取必需配置，错误只包含变量名，不回显其值。 */
export function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value || !value.trim()) throw new Error(`缺少在线运行配置：${name}`)
  return value
}

/** 组合在线入口配置；用于独立的回环服务，不允许指定监听地址。 */
export function hostedConfig(): { origin: URL; port: number; oidc: HostedOidcOptions } {
  const origin = hostedOrigin(requiredEnv('RELEASE_HARBOR_HOSTED_ORIGIN'))
  const port = Number(process.env.RELEASE_HARBOR_HOSTED_PORT ?? 4408)
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('在线回环端口必须为 1024–65535 的整数')
  return {
    origin,
    port,
    oidc: {
      issuer: configuredIssuer(requiredEnv('RELEASE_HARBOR_HOSTED_OIDC_ISSUER')),
      clientId: requiredEnv('RELEASE_HARBOR_HOSTED_OIDC_CLIENT_ID'),
      clientSecret: requiredEnv('RELEASE_HARBOR_HOSTED_OIDC_CLIENT_SECRET'),
      callback: new URL(callbackPath, origin).href,
    },
  }
}

/** 生成固定回调地址，避免把外部 Host 和 URL 带入授权交换。 */
export function hostedCallback(origin: URL): URL {
  return new URL(callbackPath, origin)
}
