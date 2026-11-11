/** @description 本机团队进程会话；浏览器持有随机 Cookie，服务仅保留摘要及账号代次。 */
import { randomBytes } from 'node:crypto'
import { DomainError } from '@release-harbor/domain'
import { digest } from '../local-files.ts'
import { validPassword, verifyTeamPassword } from './password.ts'
import { teamUsername, type LocalTeamStore, type TeamAccount } from './store.ts'

/** Cookie 按实际服务端口区分本机安装，HTTPS 内网入口另行设计。 */
export const teamSessionSeconds = 8 * 60 * 60

type Session = { id: string; revision: number; expires: number }

/** 登录限速和会话只存在本机进程；关闭或重启后需要重新登录。 */
export class LocalTeamSessions {
  private readonly sessions = new Map<string, Session>()
  private pending = 0
  private failures = 0
  private windowEnd = 0

  constructor(private readonly store: LocalTeamStore) {}

  /** 每次请求与当前账号状态对照，密码、停用等变更立即废弃旧会话。 */
  current(accounts: TeamAccount[], token: string | undefined): TeamAccount | undefined {
    if (!token) return
    const key = digest(token)
    const session = this.sessions.get(key)
    if (!session) return
    const account = accounts.find(
      (item) => item.id === session.id && item.enabled && item.revision === session.revision,
    )
    if (session.expires > Date.now() && account) return account
    this.sessions.delete(key)
  }

  /** 只在当前账号有效且密码匹配时生成会话；拒绝过多本机并发派生。 */
  async login(username: unknown, value: unknown): Promise<string> {
    const now = Date.now()
    if (now >= this.windowEnd) {
      this.failures = 0
      this.windowEnd = now + 60_000
    }
    if (this.failures >= 12 || this.pending >= 3)
      throw new DomainError('登录尝试过多，请稍后再试', 429)
    this.pending++
    try {
      // 1. 无效账号与错误口令使用同一失败提示，不公开账号存在性。
      const accounts = await this.store.read()
      if (!accounts) throw new DomainError('本机团队尚未启用', 409)
      const name = teamUsername(username)
      const account = accounts.find((item) => item.username === name && item.enabled)
      const expected = account ?? accounts[0]
      if (
        !expected ||
        !validPassword(value) ||
        !(await verifyTeamPassword(value, expected)) ||
        !account
      ) {
        this.failures++
        throw new DomainError('登录名或密码不正确，或账号已停用', 401)
      }
      // 2. 派生期间管理员可能变更账号，旧代次不能获得新会话。
      const latest = await this.store.read()
      if (
        !latest?.some(
          (item) => item.id === account.id && item.revision === account.revision && item.enabled,
        )
      )
        throw new DomainError('账号已变更，请重新登录', 401)
      const token = randomBytes(32).toString('base64url')
      for (const [key, session] of this.sessions)
        if (session.expires <= Date.now()) this.sessions.delete(key)
      if (this.sessions.size >= 256) throw new DomainError('本机登录会话已满，请先退出旧会话', 429)
      this.sessions.set(digest(token), {
        id: account.id,
        revision: account.revision,
        expires: Date.now() + teamSessionSeconds * 1000,
      })
      return token
    } finally {
      this.pending--
    }
  }

  /** 撤销当前随机能力，旧 Cookie 不能再次使用。 */
  logout(token: string | undefined): void {
    if (token) this.sessions.delete(digest(token))
  }
}
