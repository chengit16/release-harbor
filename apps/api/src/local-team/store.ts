/** @description 安装级团队账号目录；不随业务备份或恢复切代，损坏时拒绝访问。 */
import { randomUUID } from 'node:crypto'
import { link, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  isLocalTeamMember,
  isTeamAuditEvent,
  hasExactKeys,
  type TeamAuditEvent,
  isRecord,
  isLocalTeamPermissions,
  type LocalTeamPermissions,
  type LocalTeamMember,
} from '@release-harbor/contracts'
import { DomainError } from '@release-harbor/domain'
import { atomicLocal, readLocal } from '../local-files.ts'
import { teamContext, type TeamActor } from './access.ts'
import type { ReleaseAuditFact } from './release-audit-facts.ts'
import { hashTeamPassword, newPassword, type TeamPassword } from './password.ts'

/** 持久账号及认证代次，仅供控制面使用。 */
export interface TeamAccount extends LocalTeamMember, TeamPassword {
  revision: number
}

/** 保留安全投影，不把内部账号结构展开给浏览器。 */
export function teamMember({
  id,
  username,
  role,
  enabled,
  permissions,
}: TeamAccount): LocalTeamMember {
  return { id, username, role, enabled, ...(permissions ? { permissions } : {}) }
}

/** 账号固定为规范小写，避免不同客户端对相同登录标识的解释不一致。 */
export function teamUsername(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-z][a-z0-9_.-]{2,31}$/.test(value) ? value : undefined
}

/** 安装级审计只保存安全事件与不可变事实指纹，不保存完整发布资料。 */
export interface StoredTeamAudit {
  event: TeamAuditEvent
  evidence: string | null
}
interface TeamDocument {
  accounts: TeamAccount[]
  audit: StoredTeamAudit[]
}
const teamLimit = 16 * 1024 * 1024

/** 单一宿主持有修改队列；初始化使用独占链接以免两次引导覆盖首位管理员。 */
export class LocalTeamStore {
  private pending: Promise<unknown> = Promise.resolve()
  private active = false
  private readonly path: string
  private readonly marker: string

  constructor(root: string) {
    this.path = join(root, '.local', 'team.json')
    this.marker = join(root, '.local', 'team-enabled.json')
  }

  /** 每次读取最新目录；运行中丢失已发现的团队状态不会降级到免登录。 */
  async read(): Promise<TeamAccount[] | null> {
    return (await this.document())?.accounts ?? null
  }

  /** 管理员及记录级查询只读取安装日志，不迁移旧目录或生成虚假事件。 */
  async audit(): Promise<StoredTeamAudit[]> {
    await this.pending
    return (await this.document())?.audit ?? []
  }

  private async document(): Promise<TeamDocument | null> {
    const raw = await readLocal(this.path, teamLimit)
    if (raw === null) {
      if (this.active || (await readLocal(this.marker, 1024)) !== null)
        throw new DomainError('本机团队目录缺失，工作台已锁定', 503)
      return null
    }
    this.active = true
    try {
      const data: unknown = JSON.parse(raw)
      if (
        !isRecord(data) ||
        !(
          (data.schemaVersion === 1 && hasExactKeys(data, ['schemaVersion', 'accounts'])) ||
          (data.schemaVersion === 2 && hasExactKeys(data, ['schemaVersion', 'accounts', 'audit']))
        ) ||
        !Array.isArray(data.accounts) ||
        data.accounts.length > 100 ||
        !data.accounts.every(isAccount) ||
        Buffer.byteLength(JSON.stringify(data.accounts)) > 512 * 1024 ||
        data.accounts.filter((a) => a.role === 'admin').length !== 1 ||
        !data.accounts.some((a) => a.role === 'admin' && a.enabled) ||
        new Set(data.accounts.map((a) => a.username)).size !== data.accounts.length ||
        new Set(data.accounts.map((a) => a.id)).size !== data.accounts.length
      )
        throw Error()
      const audit: unknown = data.schemaVersion === 1 ? [] : data.audit
      if (
        !Array.isArray(audit) ||
        audit.length > 20000 ||
        !audit.every(isStoredAudit) ||
        new Set(audit.map((a) => a.event.id)).size !== audit.length
      )
        throw Error()
      return { accounts: data.accounts, audit }
    } catch {
      throw new DomainError('本机团队目录或审计无法读取，工作台已锁定', 503)
    }
  }

  /** 仅可信本机 CLI 调用；从未初始化的安装建立首位管理员，不覆盖既有文件。 */
  async initialize(username: unknown, value: unknown): Promise<void> {
    if ((await readLocal(this.marker, 1024)) !== null)
      throw new DomainError('本机团队已经启用，不能重新创建管理员', 409)
    const admin = await account(username, value, 'admin')
    const staged = this.path + '.' + randomUUID() + '.init'
    try {
      await atomicLocal(staged, { schemaVersion: 1, accounts: [admin] })
      await link(staged, this.path)
      // 独立安装标记用于重启后识别遗失目录，业务恢复不会触及这两个文件。
      await atomicLocal(this.marker, { schemaVersion: 1 })
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'EEXIST')
        throw new DomainError('本机团队已经启用，不能重新创建管理员', 409)
      throw error
    } finally {
      await rm(staged, { force: true })
    }
  }

  /** 成员建立后默认无业务权限；管理员账号只能由可信终端初始化。 */
  async add(username: unknown, value: unknown): Promise<LocalTeamMember> {
    return this.change('member_create', async (accounts) => {
      if (accounts.length >= 100) throw new DomainError('本机团队账号已达到上限', 409)
      if (accounts.some((member) => member.username === username))
        throw new DomainError('登录名已存在', 409)
      const member = await account(username, value, 'member')
      accounts.push(member)
      return teamMember(member)
    })
  }

  /** 仅修改成员，任何密码或启停变更都退役旧会话。 */
  async update(
    id: string,
    action: 'enable' | 'disable' | 'reset',
    value?: unknown,
  ): Promise<LocalTeamMember> {
    return this.change(
      action === 'reset'
        ? 'member_reset'
        : action === 'enable'
          ? 'member_enable'
          : 'member_disable',
      async (accounts) => {
        const member = accounts.find(
          (candidate) => candidate.id === id && candidate.role === 'member',
        )
        if (!member) throw new DomainError('成员不存在', 404)
        if (action === 'reset') Object.assign(member, await hashTeamPassword(newPassword(value)))
        else member.enabled = action === 'enable'
        member.revision++
        return teamMember(member)
      },
    )
  }

  /** 权限独立于会话代次，变更立即生效；预期版本防止多个管理窗口互相覆盖。 */
  async setPermissions(id: string, input: unknown): Promise<LocalTeamMember> {
    if (!isLocalTeamPermissions(input)) throw new DomainError('成员权限格式不正确')
    return this.change('member_permissions', async (accounts) => {
      const member = accounts.find((a) => a.id === id && a.role === 'member')
      if (!member) throw new DomainError('成员不存在', 404)
      if ((member.permissions?.revision ?? 0) !== input.revision)
        throw new DomainError('成员权限已变化，请重新打开授权窗口', 409)
      member.permissions = { ...structuredClone(input), revision: input.revision + 1 }
      return teamMember(member)
    })
  }

  /** 发布日志先于业务落盘；未匹配意图保留，不能当作成功或自动重放。 */
  async recordFacts(
    actor: TeamActor,
    facts: ReleaseAuditFact[],
  ): Promise<{ id: string; evidence: string }[]> {
    if (!facts.length) return []
    return this.mutate(async (document) => {
      const operator = checkedActor(document.accounts, actor)
      const links = []
      for (const fact of facts) {
        // 每次业务提交使用新关联 ID，失败意图不能在后来相同输入成功时冒充原操作者。
        const id = randomUUID()
        links.push({ id, evidence: fact.evidence })
        document.audit.push({
          evidence: fact.evidence,
          event: {
            id,
            at: fact.at,
            actor: { id: operator.id, username: operator.username },
            action: fact.action,
            member: null,
            target: fact.target,
            state: 'unmatched',
            outcome: null,
          },
        })
      }
      return links
    })
  }

  private change<T>(
    action: TeamAuditEvent['action'],
    run: (accounts: TeamAccount[]) => Promise<T>,
  ): Promise<T> {
    const actor = teamContext.getStore()
    return this.mutate(async (document) => {
      const operator = actor ? checkedActor(document.accounts, actor) : undefined
      if (operator && operator.role !== 'admin') throw new DomainError('此操作仅限本机管理员', 403)
      const before = document.accounts.map(teamMember).map((m) => structuredClone(m))
      const result = await run(document.accounts)
      // 仅由可信认证上下文产生操作者；CLI 与旧测试调用不推测当前管理员。
      if (operator && isLocalTeamMember(result)) {
        const target = document.accounts.find((a) => a.id === result.id)
        if (!target) throw new Error('成员变更结果缺少对应账号')
        document.audit.push({
          evidence: null,
          event: {
            id: randomUUID(),
            at: new Date().toISOString(),
            actor: { id: operator.id, username: operator.username },
            action,
            member: {
              before: before.find((a) => a.id === result.id) ?? null,
              after: structuredClone(teamMember(target)),
            },
            target: null,
            state: 'atomic',
            outcome: null,
          },
        })
      }
      return result
    })
  }

  private mutate<T>(run: (document: TeamDocument) => Promise<T>): Promise<T> {
    const next = this.pending.then(async () => {
      const document = await this.document()
      if (!document) throw new DomainError('本机团队尚未启用', 409)
      const result = await run(document)
      const data = { schemaVersion: 2, ...document }
      if (
        Buffer.byteLength(JSON.stringify(document.accounts)) > 512 * 1024 ||
        document.audit.length > 20000 ||
        Buffer.byteLength(JSON.stringify(data)) > teamLimit
      )
        throw new DomainError('团队目录或审计已达到容量上限，请联系本机管理员', 409)
      await atomicLocal(this.path, data)
      return result
    })
    // 单次失败仍交回调用方，但不会污染后续目录写入。
    this.pending = next.catch(() => undefined)
    return next
  }
}

async function account(
  username: unknown,
  value: unknown,
  role: LocalTeamMember['role'],
): Promise<TeamAccount> {
  const name = teamUsername(username)
  if (!name) throw new DomainError('登录名须以小写字母开头，使用 3 至 32 位小写字母、数字或 ._-')
  const hash = await hashTeamPassword(newPassword(value))
  return { id: randomUUID(), username: name, role, enabled: true, revision: 1, ...hash }
}

function isAccount(value: unknown): value is TeamAccount {
  if (!isRecord(value)) return false
  const { salt, hash, revision } = value
  return (
    isLocalTeamMember(value) &&
    /^[a-f0-9-]{36}$/.test(value.id) &&
    Boolean(teamUsername(value.username)) &&
    typeof salt === 'string' &&
    /^[a-f0-9]{48}$/.test(salt) &&
    typeof hash === 'string' &&
    /^[a-f0-9]{128}$/.test(hash) &&
    typeof revision === 'number' &&
    Number.isSafeInteger(revision) &&
    revision > 0
  )
}

function isStoredAudit(value: unknown): value is StoredTeamAudit {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['event', 'evidence']) &&
    isTeamAuditEvent(value.event) &&
    (value.event.state === 'atomic'
      ? value.evidence === null
      : value.event.state === 'unmatched' &&
        value.event.outcome === null &&
        typeof value.evidence === 'string' &&
        /^[a-f0-9]{64}$/.test(value.evidence))
  )
}
function checkedActor(accounts: TeamAccount[], actor: TeamActor): TeamAccount {
  const account = accounts.find((a) => a.id === actor.id)
  if (
    !account?.enabled ||
    account.revision !== actor.revision ||
    (actor.valid && !actor.valid(accounts))
  )
    throw new DomainError('成员会话已失效，请重新登录', 401)
  return account
}
