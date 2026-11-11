/** @description 服务端会话与空间授权；回调一次性消费，目录操作在同一事务中重新核验角色。 */
import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import type { HostedSessionView, HostedWorkspace } from '@release-harbor/contracts'
import { DomainError } from '@release-harbor/domain'
import { transaction } from './database.ts'
import { hostedId, hostedLabel, type HostedIdentity, type LoginFlow } from './identity.ts'

/** 会话绝对有效期，单位秒；服务端和 Cookie 使用同一个上限。 */
export const sessionSeconds = 8 * 60 * 60
/** 浏览器绑定的登录事务有效期，单位秒。 */
export const loginSeconds = 5 * 60

/** 已核验的空间事务；仅在 scope 回调期间有效。 */
export interface HostedScope {
  /** 此次请求有权访问的工作空间。 */
  workspaceId: string
  /** 已锁定会话和成员关系的数据库事务连接。 */
  client: PoolClient
}

/** 业务权限由当前成员角色决定；操作员可处理产物，只有管理员可维护目录。 */
export type HostedAccess = 'read' | 'operate' | 'admin'

/** 管理登录事务、会话及工作空间的访问边界，不读写本机目录。 */
export class HostedSessions {
  constructor(
    private readonly pool: Pool,
    private readonly issuer: string,
  ) {}

  /** 保存登录事务，清理过期值并退役此浏览器的旧流程。 */
  async begin(digest: string, flow: LoginFlow, previous?: string): Promise<void> {
    await transaction(this.pool, async (client) => {
      await client.query(
        'DELETE FROM rh_hosted.login_flows WHERE expires_at <= now() OR digest = $1',
        [previous ?? null],
      )
      await client.query(
        `INSERT INTO rh_hosted.login_flows (digest, state, nonce, verifier, expires_at)
         VALUES ($1, $2, $3, $4, now() + $5 * interval '1 second')`,
        [digest, flow.state, flow.nonce, flow.verifier, loginSeconds],
      )
    })
  }

  /** 从数据库原子取走未过期流程；无论交换成功与否均不复用。 */
  async take(digest: string | undefined): Promise<LoginFlow> {
    if (!digest) throw loginExpired()
    const result = await this.pool.query<LoginFlow>(
      `DELETE FROM rh_hosted.login_flows
       WHERE digest = $1 AND expires_at > clock_timestamp() RETURNING state, nonce, verifier`,
      [digest],
    )
    if (!result.rows[0]) throw loginExpired()
    return result.rows[0]
  }

  /** 仅给有成员关系的可信身份创建新会话；同浏览器的旧会话同时退役。 */
  async issue(digest: string, identity: HostedIdentity, previous?: string): Promise<void> {
    if (identity.issuer !== this.issuer) throw new DomainError('登录身份未获允许', 403)
    await transaction(this.pool, async (client) => {
      const membership = await client.query(
        `SELECT id FROM rh_hosted.members
         WHERE issuer = $1 AND subject = $2 LIMIT 1 FOR SHARE`,
        [identity.issuer, identity.subject],
      )
      if (!membership.rowCount) throw new DomainError('此身份尚未受邀加入工作空间', 403)
      await client.query(
        'DELETE FROM rh_hosted.sessions WHERE expires_at <= now() OR digest = $1',
        [previous ?? null],
      )
      await client.query(
        `INSERT INTO rh_hosted.sessions (digest, issuer, subject, expires_at)
         VALUES ($1, $2, $3, now() + $4 * interval '1 second')`,
        [digest, identity.issuer, identity.subject, sessionSeconds],
      )
    })
  }

  /** 从存储撤销当前 Cookie 对应的会话；支持重复退出。 */
  async end(digest: string | undefined): Promise<void> {
    if (digest) await this.pool.query('DELETE FROM rh_hosted.sessions WHERE digest = $1', [digest])
  }

  /** 返回当前成员关系，不使用会话创建时的角色快照。 */
  async view(digest: string | undefined): Promise<HostedSessionView> {
    return transaction(this.pool, async (client) => {
      const identity = await this.session(client, digest)
      const result = await client.query<HostedWorkspace>(
        `SELECT w.id, w.name, w.key, m.role
         FROM rh_hosted.members m JOIN rh_hosted.workspaces w ON w.id = m.workspace_id
         WHERE m.issuer = $1 AND m.subject = $2 ORDER BY w.name, w.id`,
        [identity.issuer, identity.subject],
      )
      return { workspaces: result.rows }
    })
  }

  /** 在归属与角色锁保护下读写目录；撤销和写入按确定次序生效。 */
  async scope<T>(
    digest: string | undefined,
    id: string,
    access: HostedAccess,
    run: (scope: HostedScope) => Promise<T>,
  ): Promise<T> {
    return transaction(this.pool, async (client) => {
      // 1. 先核对会话和成员，未获准的请求不占用该空间写锁。
      const identity = await this.session(client, digest, false)
      const workspaceId = hostedId(id)
      await this.membership(client, workspaceId, identity, access, false)

      // 2. 管理写入按空间串行，确保两个管理员不能并发移除最后一个管理员。
      if (access !== 'read')
        await client.query('SELECT id FROM rh_hosted.workspaces WHERE id = $1 FOR NO KEY UPDATE', [
          workspaceId,
        ])

      // 3. 等待写锁期间角色或会话可能变化；锁定并复核后才读取或更改业务对象。
      const current = await this.session(client, digest)
      await this.membership(client, workspaceId, current, access, true)
      return run({ workspaceId, client })
    })
  }

  /** 维护命令只创建新空间及其首个管理员，重复运行不会改动旧权限。 */
  async bootstrap(key: string, name: string, subject: string, label: string): Promise<string> {
    if (!/^[a-z][a-z0-9-]{1,39}$/.test(key)) throw new DomainError('工作空间标识格式不正确')
    const id = randomUUID()
    await transaction(this.pool, async (client) => {
      await client.query('INSERT INTO rh_hosted.workspaces (id, name, key) VALUES ($1, $2, $3)', [
        id,
        hostedLabel(name),
        key,
      ])
      await client.query(
        `INSERT INTO rh_hosted.members (workspace_id, id, issuer, subject, label, role)
         VALUES ($1, $2, $3, $4, $5, 'admin')`,
        [id, randomUUID(), this.issuer, subject, hostedLabel(label)],
      )
    })
    return id
  }

  private async session(client: PoolClient, digest: string | undefined, lock = true) {
    if (!digest) throw new DomainError('请先登录在线控制台', 401)
    const result = await client.query<HostedIdentity>(
      `SELECT issuer, subject FROM rh_hosted.sessions
       WHERE digest = $1 AND issuer = $2 AND expires_at > clock_timestamp()${lock ? ' FOR SHARE' : ''}`,
      [digest, this.issuer],
    )
    if (!result.rows[0]) throw new DomainError('登录已失效，请重新登录', 401)
    return result.rows[0]
  }

  private async membership(
    client: PoolClient,
    workspaceId: string,
    identity: HostedIdentity,
    access: HostedAccess,
    lock: boolean,
  ) {
    const result = await client.query<{ role: string }>(
      `SELECT role FROM rh_hosted.members WHERE workspace_id = $1 AND issuer = $2 AND subject = $3
       ${lock ? 'FOR SHARE' : ''}`,
      [workspaceId, identity.issuer, identity.subject],
    )
    const member = result.rows[0]
    if (!member) throw new DomainError('工作空间不存在', 404)
    if (access === 'admin' && member.role !== 'admin')
      throw new DomainError('此操作仅限工作空间管理员', 403)
    if (access === 'operate' && member.role === 'viewer')
      throw new DomainError('此操作需要发布操作员或管理员权限', 403)
  }
}

function loginExpired() {
  return new DomainError('登录请求已失效，请重新开始登录', 400)
}
