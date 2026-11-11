/** @description 在既有业务路由进入前统一核对本机团队会话，未逐项开放的业务默认仅管理员可用。 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { DomainError } from '@release-harbor/domain'
import type { LocalTeamSession } from '@release-harbor/contracts'
import { teamContext, currentTeamAccount } from './access.ts'
import type { LocalTeamPolicy } from './policy.ts'
import { LocalTeamSessions, teamSessionSeconds } from './sessions.ts'
import { teamMember, type LocalTeamStore, type TeamAccount } from './store.ts'

type Identity = { accounts: TeamAccount[]; member?: TeamAccount }

/** 认证与来源校验共用实际回环端口；个人模式保留既有入口。 */
export class LocalTeamRuntime {
  private readonly identities = new WeakMap<FastifyRequest, Identity>()
  private readonly sessions?: LocalTeamSessions
  private readonly cookie: string

  constructor(
    private readonly port: number,
    readonly store?: LocalTeamStore,
    readonly policy?: LocalTeamPolicy,
  ) {
    this.sessions = store ? new LocalTeamSessions(store) : undefined
    this.cookie = 'rh_team_' + port
  }

  /** 通过匹配后的路由保护所有业务 Controller；无匹配的 API 也不落入免登录静态分支。 */
  install(server: FastifyInstance): void {
    server.addHook('onRequest', async (request, reply) => {
      const route = request.routeOptions.url ?? ''
      if (!route.startsWith('/api/') && !/^\/api(?:\/|[?#]|$)/.test(request.url)) return
      try {
        const accounts = await this.store?.read()
        if (!accounts) return
        reply.header('Cache-Control', 'no-store')

        // 1. 团队请求只接受真实回环端口；兼容单人版的开发代理和历史隧道不用于登录。
        const host = request.headers.host
        const origin = request.headers.origin
        if (
          (host !== '127.0.0.1:' + this.port && host !== 'localhost:' + this.port) ||
          (origin !== undefined && origin !== 'http://' + host) ||
          (!['GET', 'HEAD'].includes(request.method) && origin !== 'http://' + host)
        )
          throw new DomainError('本机团队仅接受工作台同源请求', 403)
        if (
          route.startsWith('/api/team/') &&
          request.method !== 'GET' &&
          request.headers['x-release-harbor-team'] !== '1'
        )
          throw new DomainError('本机团队请求缺少操作标记', 403)

        // 2. 明确列出公开入口，账号状态变化后不允许旧请求继续通过新一轮认证。
        const member = this.sessions?.current(accounts, this.token(request))
        this.identities.set(request, { accounts, member })
        if (
          (request.method === 'GET' && ['/api/health', '/api/team/session'].includes(route)) ||
          (request.method === 'POST' && route === '/api/team/login')
        )
          return
        if (!member) throw new DomainError('请先登录本机团队工作台', 401)
      } catch (error) {
        const statusCode = error instanceof DomainError ? error.statusCode : 503
        const message = error instanceof DomainError ? error.message : '本机团队验证暂不可用'
        await reply.status(statusCode).send({ statusCode, message })
      }
    })
    // 3. 回调形式将可信身份绑定到后续 Controller 的异步链，后台任务继承发起身份。
    server.addHook('onRequest', (request, _reply, done) => {
      const member = this.identities.get(request)?.member
      const token = this.token(request)
      const actor =
        member && this.store
          ? {
              store: this.store,
              id: member.id,
              revision: member.revision,
              valid: (accounts: TeamAccount[]) => !!this.sessions?.current(accounts, token),
            }
          : undefined
      teamContext.run(actor, done)
    })
    server.addHook('preHandler', async (request) => {
      const member = await currentTeamAccount()
      const route = request.routeOptions.url ?? ''
      if (
        !member ||
        member.role === 'admin' ||
        ['/api/team/session', '/api/team/login', '/api/health'].includes(route)
      )
        return
      if (!this.policy) throw new DomainError('当前账号没有此操作的权限', 403)
      await this.policy.authorize(member, request)
    })
    server.addHook('preSerialization', async (request, reply, payload) => {
      // 退出成功已经撤销当前会话，写响应不能再次验证刚退役的令牌而把成功改成 401。
      if (reply.statusCode >= 400 || request.method !== 'GET') return payload
      const member = await currentTeamAccount()
      if (!member || member.role === 'admin' || !this.policy) return payload
      return this.policy.projection.filter(member, request, payload)
    })
  }

  /** 当前会话只投影账号身份；个人模式与未登录明确区分。 */
  session(request: FastifyRequest): LocalTeamSession {
    const identity = this.identities.get(request)
    if (!identity) return { mode: 'personal' }
    return identity.member
      ? { mode: 'signed_in', member: teamMember(identity.member) }
      : { mode: 'signed_out' }
  }

  /** 登录后仅以 HttpOnly Cookie 发放能力，不写入 JSON。 */
  async login(reply: FastifyReply, username: unknown, value: unknown): Promise<void> {
    if (!this.sessions) throw new DomainError('本机团队尚未启用', 409)
    const token = await this.sessions.login(username, value)
    reply.header('Set-Cookie', this.cookieValue(token, teamSessionSeconds))
  }

  /** 退出同时删除服务端能力与当前浏览器 Cookie。 */
  logout(request: FastifyRequest, reply: FastifyReply): void {
    this.sessions?.logout(this.token(request))
    reply.header('Set-Cookie', this.cookieValue('', 0))
  }

  /** 管理端显式要求当前管理员，避免新增 Controller 绕过统一边界。 */
  administrator(request: FastifyRequest): { accounts: TeamAccount[]; store: LocalTeamStore } {
    const identity = this.identities.get(request)
    if (identity?.member?.role !== 'admin' || !this.store)
      throw new DomainError('此操作仅限本机管理员', 403)
    return { accounts: identity.accounts, store: this.store }
  }

  private token(request: FastifyRequest): string | undefined {
    const key = this.cookie + '='
    const value = request.headers.cookie
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(key))
      ?.slice(key.length)
    return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined
  }

  private cookieValue(token: string, seconds: number): string {
    return `${this.cookie}=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${seconds}`
  }
}
