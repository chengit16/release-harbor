/** @description 已配置的 OIDC 客户端；只输出经签名校验的稳定身份，不保留身份供应商 token。 */
import * as oidc from 'openid-client'
import { DomainError } from '@release-harbor/domain'
import { hostedSubject, type HostedIdentity, type LoginFlow } from './identity.ts'

/** 登录服务端口；生产使用真实 OIDC，测试可用合成身份替身。 */
export interface HostedLogin {
  /** 与成员关系使用同一精确发行者标识。 */
  readonly issuer: string
  /** 生成授权地址以及只在服务端暂存的浏览器绑定事务。 */
  begin(): Promise<{ url: string; flow: LoginFlow }>
  /** 用固定回调与一次性事务交换已验证身份。 */
  finish(callback: URL, flow: LoginFlow): Promise<HostedIdentity>
}

/** 受运维配置约束的单一 HTTPS OIDC 客户端。 */
export interface HostedOidcOptions {
  /** 精确匹配 IdP 元数据的发行者地址。 */
  issuer: string
  /** IdP 为在线控制台分配的客户端标识。 */
  clientId: string
  /** 服务端客户端密钥；不得进入 Web 构建。 */
  clientSecret: string
  /** 由控制台来源固定生成的 HTTPS 回调地址。 */
  callback: string
}

/** 发现 IdP 并强制签名验证；始终使用授权码、S256、state 和 nonce。 */
export async function createHostedLogin(options: HostedOidcOptions): Promise<HostedLogin> {
  const config = await oidc.discovery(
    new URL(options.issuer),
    options.clientId,
    options.clientSecret,
  )
  const metadata = config.serverMetadata()
  if (
    metadata.issuer !== options.issuer ||
    !metadata.jwks_uri ||
    !metadata.authorization_endpoint ||
    !metadata.token_endpoint ||
    ![metadata.jwks_uri, metadata.authorization_endpoint, metadata.token_endpoint].every((url) =>
      url.startsWith('https://'),
    ) ||
    (metadata.code_challenge_methods_supported && !metadata.supportsPKCE())
  )
    throw new Error('身份提供方不符合在线登录约定')
  oidc.enableNonRepudiationChecks(config)

  return {
    issuer: metadata.issuer,
    async begin() {
      const flow = {
        verifier: oidc.randomPKCECodeVerifier(),
        state: oidc.randomState(),
        nonce: oidc.randomNonce(),
      }
      const url = oidc.buildAuthorizationUrl(config, {
        redirect_uri: options.callback,
        scope: 'openid',
        code_challenge: await oidc.calculatePKCECodeChallenge(flow.verifier),
        code_challenge_method: 'S256',
        state: flow.state,
        nonce: flow.nonce,
      })
      return { url: url.href, flow }
    },
    async finish(callback, flow) {
      try {
        const tokens = await oidc.authorizationCodeGrant(config, callback, {
          pkceCodeVerifier: flow.verifier,
          expectedState: flow.state,
          expectedNonce: flow.nonce,
        })
        const claims = tokens.claims()
        if (!claims || claims.iss !== metadata.issuer) throw new Error('发行者不匹配')
        return { issuer: claims.iss, subject: hostedSubject(claims.sub) }
      } catch {
        // 上游错误可能包含 token 或账户详情，只投影固定的登录失败信息。
        throw new DomainError('身份提供方未完成登录验证', 400)
      }
    },
  }
}
