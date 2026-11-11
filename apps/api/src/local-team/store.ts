/** @description 安装级团队账号目录；不随业务备份或恢复切代，损坏时拒绝访问。 */
import { randomUUID } from 'node:crypto'
import { link, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  isLocalTeamMember,
  isRecord,
  isLocalTeamPermissions,
  type LocalTeamPermissions,
  type LocalTeamMember,
} from '@release-harbor/contracts'
import { DomainError } from '@release-harbor/domain'
import { atomicLocal, readLocal } from '../local-files.ts'
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
    const raw = await readLocal(this.path, 512 * 1024)
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
        data.schemaVersion !== 1 ||
        !Array.isArray(data.accounts) ||
        data.accounts.length > 100 ||
        !data.accounts.every(isAccount) ||
        data.accounts.filter((account) => account.role === 'admin').length !== 1 ||
        !data.accounts.some((account) => account.role === 'admin' && account.enabled) ||
        new Set(data.accounts.map((account) => account.username)).size !== data.accounts.length ||
        new Set(data.accounts.map((account) => account.id)).size !== data.accounts.length
      )
        throw Error()
      return data.accounts
    } catch {
      throw new DomainError('本机团队目录无法读取，工作台已锁定', 503)
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
    return this.change(async (accounts) => {
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
    return this.change(async (accounts) => {
      const member = accounts.find(
        (candidate) => candidate.id === id && candidate.role === 'member',
      )
      if (!member) throw new DomainError('成员不存在', 404)
      if (action === 'reset') Object.assign(member, await hashTeamPassword(newPassword(value)))
      else member.enabled = action === 'enable'
      member.revision++
      return teamMember(member)
    })
  }

  /** 权限独立于会话代次，变更立即生效；预期版本防止多个管理窗口互相覆盖。 */
  async setPermissions(id: string, input: unknown): Promise<LocalTeamMember> {
    if (!isLocalTeamPermissions(input)) throw new DomainError('成员权限格式不正确')
    return this.change(async (accounts) => {
      const member = accounts.find((a) => a.id === id && a.role === 'member')
      if (!member) throw new DomainError('成员不存在', 404)
      if ((member.permissions?.revision ?? 0) !== input.revision)
        throw new DomainError('成员权限已变化，请重新打开授权窗口', 409)
      member.permissions = { ...structuredClone(input), revision: input.revision + 1 }
      return teamMember(member)
    })
  }

  private change<T>(run: (accounts: TeamAccount[]) => Promise<T>): Promise<T> {
    const next = this.pending.then(async () => {
      const accounts = await this.read()
      if (!accounts) throw new DomainError('本机团队尚未启用', 409)
      const result = await run(accounts)
      const data = { schemaVersion: 1, accounts }
      // 授权体积也纳入安装目录预算，不能写入下一次启动无法读取的账号文件。
      if (Buffer.byteLength(JSON.stringify(data)) > 512 * 1024)
        throw new DomainError('团队目录已达到容量上限，请减少授权范围', 409)
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
