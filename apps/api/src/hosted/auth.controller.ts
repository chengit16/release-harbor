/** @description 在线登录、回调及退出；浏览器只持有不可读的会话 Cookie。 */
import { Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { DomainError } from '@release-harbor/domain'
import type { HostedSessionView } from '@release-harbor/contracts'
import { hostedCallback } from './config.ts'
import { randomToken, tokenDigest } from './identity.ts'
import type { HostedLogin } from './oidc.ts'
import { HostedSessions, loginSeconds, sessionSeconds } from './session-store.ts'

/** 注入固定在线来源的令牌。 */
export const HOSTED_ORIGIN = Symbol('HOSTED_ORIGIN')
/** 注入身份提供方登录端口的令牌。 */
export const HOSTED_LOGIN = Symbol('HOSTED_LOGIN')
const sessionCookie = '__Host-rh-hosted-session'
const loginCookie = '__Host-rh-hosted-login'
const cookieFlags = { secure: true, httpOnly: true, sameSite: 'lax', path: '/' } as const

/** 从在线专属 Cookie 取得用于会话查找的摘要。 */
export function requestSession(request: FastifyRequest): string | undefined {
  return tokenDigest(request.cookies[sessionCookie])
}

/** 实现同源登录流程；身份或角色不从浏览器正文获取。 */
@Controller()
export class HostedAuthController {
  constructor(
    @Inject(HOSTED_ORIGIN) private readonly origin: URL,
    @Inject(HOSTED_LOGIN) private readonly login: HostedLogin,
    @Inject(HostedSessions) private readonly sessions: HostedSessions,
  ) {}

  /** 建立短期登录事务，客户端只接收 IdP 授权地址。 */
  @Post('auth/start')
  @HttpCode(200)
  async begin(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ url: string }> {
    const { url, flow } = await this.login.begin()
    const token = randomToken()
    await this.sessions.begin(
      requiredDigest(token),
      flow,
      tokenDigest(request.cookies[loginCookie]),
    )
    reply.setCookie(loginCookie, token, { ...cookieFlags, maxAge: loginSeconds })
    return { url }
  }

  /** 只用请求的查询参数和已配置回调；登录事务无论成功与否均不能再消费。 */
  @Get('auth/callback')
  async callback(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<FastifyReply> {
    const digest = tokenDigest(request.cookies[loginCookie])
    reply.clearCookie(loginCookie, cookieFlags)
    try {
      const flow = await this.sessions.take(digest)
      const callback = hostedCallback(this.origin)
      const queryStart = request.url.indexOf('?')
      if (queryStart >= 0) callback.search = request.url.slice(queryStart)
      const identity = await this.login.finish(callback, flow)
      const token = randomToken()
      await this.sessions.issue(requiredDigest(token), identity, requestSession(request))
      reply.setCookie(sessionCookie, token, { ...cookieFlags, maxAge: sessionSeconds })
      return reply.redirect('/', 303)
    } catch (error) {
      if (!(error instanceof DomainError)) throw error
      return reply.redirect(
        error.statusCode === 403 ? '/?login=invitation' : '/?login=invalid',
        303,
      )
    }
  }

  /** 从服务器撤销当前会话再清除 Cookie；不依赖 IdP 登出支持。 */
  @Post('auth/logout')
  @HttpCode(200)
  async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ ok: true }> {
    await this.sessions.end(requestSession(request))
    reply.clearCookie(sessionCookie, cookieFlags)
    return { ok: true }
  }

  /** 读取此会话当前仍有权访问的空间。 */
  @Get('session')
  session(@Req() request: FastifyRequest): Promise<HostedSessionView> {
    return this.sessions.view(requestSession(request))
  }
}

function requiredDigest(token: string): string {
  const digest = tokenDigest(token)
  if (!digest) throw new Error('服务端未生成有效的会话标识')
  return digest
}
