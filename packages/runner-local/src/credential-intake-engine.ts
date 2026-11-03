/** @description 独立配置进程的保存编排；材料只在本进程内存中，操作意图和回报均为安全投影。 */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type {
  CredentialAccounts,
  CredentialOperation,
  BindingChannel,
  CredentialAccount,
  CredentialAccountAction,
  CredentialAccountResult,
  CredentialReplacement,
} from '@release-harbor/contracts'
import {
  CredentialInputError,
  validateCredentialSubmission,
  type CredentialRepository,
} from '@release-harbor/provider-app-ship'
import { CredentialAccountStore } from './credential-account-store.ts'
import type { CredentialSetupSession } from './credential-session-protocol.ts'

interface SessionState {
  session: CredentialSetupSession
  origin: string
  status: 'open' | 'admitting' | 'saving' | 'closed'
  replacement?: CredentialReplacement
}

/** 仅带固定安全文本的 HTTP 错误，不暴露存储和 SDK 异常原文。 */
export class CredentialIntakeError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message)
  }
}

/** 配置动作串行接纳，CLI 的跨进程竞争仍交由 SDK 写锁独立拒绝。 */
export class CredentialIntakeEngine {
  private readonly sessions = new Map<string, SessionState>()
  private background: Promise<void> | null = null
  private admitting = false
  private closing = false
  private faulty = false
  constructor(
    private readonly store: CredentialAccountStore,
    private readonly repository: CredentialRepository,
    private readonly now: () => number = Date.now,
  ) {}

  /** 只从安全元数据恢复事实；元数据缺失不自动重放、解密或假设回滚已经完成。 */
  async initialize(): Promise<void> {
    const operations = await this.store.list()
    for (const operation of operations.filter((o) => o.status === 'saving')) {
      // 元数据不能证明秘密完整可读，重启后必须由用户显式重新核对。
      await this.store.save({
        ...operation,
        status: 'needs_reconciliation',
        code: 'needs_reconciliation',
      })
    }
  }

  private assertHealthy(): void {
    if (this.closing || this.faulty)
      throw new CredentialIntakeError('本机配置服务暂不可用，请检查存储后重启', 503)
  }

  /** 目录只关联标签，不读取秘密；待核对档案即使有旧元数据也不能选用。 */
  async accounts(): Promise<CredentialAccounts> {
    this.assertHealthy()
    const catalog = await this.repository.catalog()
    if (catalog.code !== 'available') return { code: catalog.code, accounts: [] }
    const operations = await this.store.list()
    const accounts: CredentialAccount[] = catalog.profiles.map((p) => {
      const operation = operations.find(
        (o) => o.reference === p.reference && o.channel === p.channel,
      )
      const name = operation?.displayName ?? p.reference
      const collision = operations.some(
        (o) => o.reference !== p.reference && o.channel === p.channel && o.displayName === name,
      )
      return {
        ...p,
        managementRevision: this.managementRevision(p.revision, operation),
        displayName: !operation && collision ? `${name} · ${p.reference.slice(-8)}` : name,
        configured: p.configured && (!operation || operation.status === 'saved'),
        legacy: !operation,
        needsReconciliation: operation?.status === 'needs_reconciliation',
        applicationCount: 0,
      }
    })
    // 中断后可能没有 SDK 元数据，仍展示非秘密意图，不能让待核对账号从列表消失。
    for (const operation of operations.filter(
      (o) => o.status !== 'failed' && !accounts.some((a) => a.reference === o.reference),
    )) {
      accounts.push({
        reference: operation.reference,
        displayName: operation.displayName,
        channel: operation.channel,
        configured: false,
        revision: '0'.repeat(64),
        managementRevision: this.managementRevision('0'.repeat(64), operation),
        legacy: false,
        needsReconciliation:
          operation.status === 'needs_reconciliation' || operation.status === 'saved',
        applicationCount: 0,
      })
    }
    return { code: 'available', accounts }
  }

  private managementRevision(revision: string, operation?: CredentialOperation): string {
    return createHash('sha256')
      .update(JSON.stringify([revision, operation ?? null]))
      .digest('hex')
  }

  private async current(input: CredentialReplacement): Promise<CredentialAccount> {
    const catalog = await this.accounts()
    if (catalog.code !== 'available') throw new CredentialIntakeError('本机账号目录暂不可用', 503)
    const account = catalog.accounts.find((a) => a.reference === input.reference)
    if (!account) throw new CredentialIntakeError('账号不存在，请刷新列表', 404)
    if (account.managementRevision !== input.expectedRevision)
      throw new CredentialIntakeError('账号已变化，请刷新后重试', 409)
    return account
  }

  /** 显式本机管理与保存互斥；缺失材料保留待核对，不会伪造远端验证结果。 */
  async manage(input: CredentialAccountAction): Promise<CredentialAccountResult> {
    this.assertHealthy()
    if (this.admitting || this.background)
      throw new CredentialIntakeError('已有账号操作正在进行，请稍后重试', 409)
    this.admitting = true
    try {
      // 1. 在互斥区核对版本，标签变更也使旧向导的替换能力失效。
      const account = await this.current(input)
      const previous = (await this.store.list()).find((o) => o.reference === input.reference)
      const operation: CredentialOperation = {
        id: randomUUID(),
        reference: account.reference,
        channel: account.channel,
        displayName:
          input.action === 'rename' ? input.displayName.trim() : account.displayName.slice(0, 60),
        createdAt: new Date(this.now()).toISOString(),
        status: account.configured ? 'saved' : 'needs_reconciliation',
        code: account.configured ? 'saved' : 'needs_reconciliation',
      }
      // 2. 删除先隔离账号；中断后仍有待核对记录，不能留下可选但材料已删除的档案。
      if (input.action === 'delete') {
        await this.store.replace(account.reference, {
          ...operation,
          status: 'needs_reconciliation',
          code: 'needs_reconciliation',
        })
        await this.repository.delete(account.reference)
        await this.store.replace(account.reference, null)
        return { code: 'deleted' }
      }
      if (input.action === 'rename') {
        const accounts = await this.accounts()
        if (
          accounts.accounts.some(
            (a) =>
              a.reference !== account.reference &&
              a.channel === account.channel &&
              a.displayName === operation.displayName,
          )
        )
          throw new CredentialIntakeError('该渠道已存在同名账号，请修改名称', 409)
        // 未完成操作不能在另一个会话中更名，否则其迟到回报会改写新标签。
        if (previous?.status === 'saving')
          throw new CredentialIntakeError('保存尚未完成，请稍后重试', 409)
        await this.store.replace(account.reference, operation)
        return { code: 'renamed' }
      }
      // 3. 只读回本机材料；钥匙串拒绝或材料不全都不能标记已配置，也不自动重放输入。
      const valid = await this.repository
        .check(account.reference, account.channel)
        .catch(() => false)
      await this.store.replace(account.reference, {
        ...operation,
        status: valid ? 'saved' : 'needs_reconciliation',
        code: valid ? 'saved' : 'needs_reconciliation',
      })
      return { code: valid ? 'checked' : 'needs_input' }
    } catch (error) {
      if (error instanceof CredentialIntakeError) throw error
      throw new CredentialIntakeError('账号操作未完成，请刷新核对；检查名称冲突或本机安全存储', 503)
    } finally {
      this.admitting = false
    }
  }

  /** 配置会话仅授权一次同渠道保存；限量和到期回收避免空向导无限积累。 */
  async createSession(
    channel: BindingChannel,
    origin: string,
    endpoint: string,
    replacement?: CredentialReplacement,
  ): Promise<CredentialSetupSession> {
    this.assertHealthy()
    if ((await this.accounts()).code !== 'available')
      throw new CredentialIntakeError('当前环境或凭据目录不可用于账号配置', 503)
    for (const [id, state] of this.sessions)
      if (Date.parse(state.session.expiresAt) <= this.now() || state.status === 'closed')
        this.sessions.delete(id)
    if (this.sessions.size >= 32)
      throw new CredentialIntakeError('配置会话过多，请稍后重新打开', 429)
    const existing = replacement ? await this.current(replacement) : undefined
    if (existing && existing.channel !== channel)
      throw new CredentialIntakeError('不能更改账号渠道', 409)
    const session: CredentialSetupSession = {
      id: randomUUID(),
      operationId: randomUUID(),
      reference: existing?.reference ?? 'profile-' + randomUUID(),
      channel,
      endpoint,
      token: randomBytes(32).toString('hex'),
      expiresAt: new Date(this.now() + 5 * 60_000).toISOString(),
    }
    this.sessions.set(session.id, { session, origin, status: 'open', replacement })
    return session
  }

  /** 校验发生在材料解析前，缺失／错误来源及错误令牌都不能进入保存逻辑。 */
  authorize(id: string, token: string, origin: string): void {
    this.assertHealthy()
    const state = this.sessions.get(id)
    if (
      !state ||
      state.session.token !== token ||
      state.origin !== origin ||
      state.status === 'closed'
    )
      throw new CredentialIntakeError('配置会话无效，请重新打开向导', 403)
    if (Date.parse(state.session.expiresAt) <= this.now())
      throw new CredentialIntakeError('配置会话已过期，请重新打开向导', 410)
  }

  /**
   * 保存一经接纳即固定引用；重复请求返回原操作，绝不再次保存材料。
   * 长函数保留原因：受理与后台收尾共用同一会话及互斥状态；校验、材料存储和记录写入已独立。
   */
  async save(id: string, raw: unknown): Promise<CredentialOperation> {
    this.assertHealthy()
    const state = this.sessions.get(id)
    if (!state) throw new CredentialIntakeError('配置会话不存在', 404)
    if (state.status === 'open' && Date.parse(state.session.expiresAt) <= this.now())
      throw new CredentialIntakeError('配置会话已过期，请重新打开向导', 410)
    if (state.status !== 'open') {
      const previous = await this.operation(state.session.operationId)
      if (previous) return previous
      throw new CredentialIntakeError('本次保存状态无法核对', 409)
    }
    let submission
    try {
      submission = validateCredentialSubmission(state.session.channel, raw)
    } catch (error) {
      throw new CredentialIntakeError(
        error instanceof CredentialInputError ? error.message : '凭据格式不正确',
      )
    }
    if (this.admitting || this.background)
      throw new CredentialIntakeError('已有账号正在保存，请稍后重试', 409)
    this.admitting = true
    // 接纳保存后即不再承诺取消，覆盖元数据写入期间的 DELETE／重复请求竞争。
    state.status = 'admitting'
    try {
      // 1. 先核对同渠道名称并持久化固定意图，秘密不进入操作文件。
      const accounts = await this.accounts()
      if (accounts.code !== 'available') throw new CredentialIntakeError('凭据目录暂不可用', 503)
      if (
        accounts.accounts.some(
          (a) =>
            a.reference !== state.replacement?.reference &&
            a.channel === state.session.channel &&
            a.displayName === submission.displayName,
        )
      )
        throw new CredentialIntakeError('该渠道已存在同名账号，请修改名称', 409)
      if (state.replacement) await this.current(state.replacement)
      const operation: CredentialOperation = {
        id: state.session.operationId,
        reference: state.session.reference,
        channel: state.session.channel,
        displayName: submission.displayName,
        status: 'saving',
        code: 'saving',
        createdAt: new Date(this.now()).toISOString(),
      }
      await (
        state.replacement
          ? this.store.replace(operation.reference, operation)
          : this.store.save(operation)
      ).catch(() => {
        throw new CredentialIntakeError('账号记录无法保存，请检查名称或存储状态', 409)
      })
      state.status = 'saving'
      // 2. 保存异步进行，失败可能含 SDK 回滚不明，统一保留待核对而非自动重试。
      this.background = Promise.resolve()
        .then(() =>
          this.repository.save(
            operation.reference,
            operation.channel,
            submission.material,
            Boolean(state.replacement),
          ),
        )
        .then(async () => {
          const catalog = await this.repository.catalog()
          const saved = catalog.profiles.some(
            (p) =>
              p.reference === operation.reference &&
              p.channel === operation.channel &&
              p.configured,
          )
          await this.store.save({
            ...operation,
            status: saved ? 'saved' : 'needs_reconciliation',
            code: saved ? 'saved' : 'needs_reconciliation',
          })
        })
        .catch(async () => {
          await this.store
            .save({ ...operation, status: 'needs_reconciliation', code: 'needs_reconciliation' })
            .catch(() => {
              this.faulty = true
            })
        })
        .finally(() => {
          this.background = null
        })
      return operation
    } finally {
      this.admitting = false
      if (state.status === 'admitting') state.status = 'open'
    }
  }

  /** 查询仅返回固定公开操作，不是读取凭据的入口。 */
  async operation(id: string): Promise<CredentialOperation | null> {
    this.assertHealthy()
    return (await this.store.list()).find((o) => o.id === id) ?? null
  }

  /** 已授权的 HTTP 会话只能查询自身操作，不接受浏览器传入其他操作 ID。 */
  async sessionOperation(id: string): Promise<CredentialOperation | null> {
    const state = this.sessions.get(id)
    return state ? this.operation(state.session.operationId) : null
  }

  /** 保存已开始时只能关闭等待，不能承诺撤销 Keychain 写入。 */
  cancel(id: string): void {
    const state = this.sessions.get(id)
    if (!state) return
    if (state.status === 'admitting' || state.status === 'saving')
      throw new CredentialIntakeError(
        '保存已经开始，关闭页面不会撤销保存，可在账号列表核对结果',
        409,
      )
    state.status = 'closed'
  }

  /** 有界退出由宿主控制；未完成意图留给下次启动核对，不重放材料。 */
  async close(): Promise<void> {
    this.closing = true
    await this.background
  }
}
