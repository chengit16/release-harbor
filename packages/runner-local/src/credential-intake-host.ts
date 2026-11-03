/** @description 本机配置进程宿主，控制面通过关联 IPC 操作会话和目录，绝不加载 SDK 或转发材料。 */
import { fork, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  isCredentialAccounts,
  isCredentialAccountResult,
  type CredentialAccountAction,
  type CredentialAccountResult,
  type CredentialReplacement,
  isCredentialOperation,
  isRecord,
  type CredentialAccounts,
  type CredentialOperation,
  type BindingChannel,
} from '@release-harbor/contracts'
import {
  isCredentialSetupSession,
  type CredentialSetupSession,
} from './credential-session-protocol.ts'

export type { CredentialSetupSession } from './credential-session-protocol.ts'

/** 测试装配可替换控制端口，但接口从不接受凭据正文。 */
export interface CredentialIntake {
  start(): Promise<void>
  accounts(): Promise<CredentialAccounts>
  session(
    channel: BindingChannel,
    origin: string,
    replacement?: CredentialReplacement,
  ): Promise<CredentialSetupSession>
  manage(input: CredentialAccountAction): Promise<CredentialAccountResult>
  operation(id: string): Promise<CredentialOperation | null>
  close(): Promise<void>
}

/** 固定可信工作进程，所有原始输出丢弃，RPC 超时不重放。 */
export class LocalCredentialIntake implements CredentialIntake {
  private child: ChildProcess | null = null
  private readonly pending = new Map<
    string,
    {
      resolve: (value: unknown) => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  constructor(
    private readonly root: string,
    private readonly origins: readonly string[],
  ) {}

  /** 生命周期显式启动，不因查询重启配置进程或重放旧动作。 */
  async start(): Promise<void> {
    if (this.child) throw new Error('配置进程已启动')
    const child = fork(
      fileURLToPath(new URL('./credential-intake-worker.ts', import.meta.url)),
      [],
      {
        execArgv: ['--import', 'tsx'],
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        env: { PATH: process.env.PATH, HOME: process.env.HOME },
      },
    )
    this.child = child
    child.on('message', (message: unknown) => {
      if (
        !isRecord(message) ||
        Object.keys(message).length !== 4 ||
        message.schemaVersion !== 1 ||
        typeof message.id !== 'string'
      )
        return
      const call = this.pending.get(message.id)
      if (!call) return
      clearTimeout(call.timer)
      this.pending.delete(message.id)
      if (message.error !== null) {
        const error =
          isRecord(message.error) &&
          typeof message.error.message === 'string' &&
          [400, 404, 409, 429, 503].includes(Number(message.error.statusCode))
            ? Object.assign(new Error(message.error.message), {
                statusCode: Number(message.error.statusCode),
              })
            : new Error('本机账号配置暂未完成，请重新打开向导或检查存储')
        call.reject(error)
      } else call.resolve(message.result)
    })
    child.on('error', () => this.failPending())
    child.on('exit', () => {
      this.child = null
      this.failPending()
    })
    try {
      const ready = await this.call('initialize', { root: this.root, origins: this.origins })
      if (!isRecord(ready) || ready.ready !== true) throw new Error('无效启动回报')
    } catch {
      // 启动失败也必须收回子进程，不能留下持有配置端口的孤立执行器。
      await this.close()
      throw new Error('本机配置进程启动失败')
    }
  }

  private failPending(): void {
    for (const call of this.pending.values()) {
      clearTimeout(call.timer)
      call.reject(new Error('本机账号配置进程未能完成操作'))
    }
    this.pending.clear()
  }

  private call(action: string, input: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const child = this.child
      if (!child?.connected || this.pending.size >= 32)
        return reject(new Error('本机账号配置服务暂不可用'))
      const id = randomUUID()
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('本机账号配置响应超时，请查询原操作结果'))
      }, 15_000)
      this.pending.set(id, { resolve, reject, timer })
      child.send({ schemaVersion: 1, id, action, input }, (error) => {
        if (error) {
          clearTimeout(timer)
          this.pending.delete(id)
          reject(new Error('本机配置请求未完成'))
        }
      })
    })
  }

  /** 目录来自安全合同，未知字段或内部对象一律拒绝。 */
  async accounts(): Promise<CredentialAccounts> {
    const result = await this.call('accounts', {})
    if (!isCredentialAccounts(result)) throw new Error('账号目录无法核对')
    return result
  }

  /** 元数据管理不携带秘密，回报仅接受公开枚举。 */
  async manage(input: CredentialAccountAction): Promise<CredentialAccountResult> {
    const result = await this.call('manage', input)
    if (!isCredentialAccountResult(result)) throw new Error('账号管理结果无法核对')
    return result
  }

  /** 配置能力只返回给当前向导；不得记录或持久化。 */
  async session(
    channel: BindingChannel,
    origin: string,
    replacement?: CredentialReplacement,
  ): Promise<CredentialSetupSession> {
    const result = await this.call('session', {
      channel,
      origin,
      ...(replacement ? { replacement } : {}),
    })
    if (!isCredentialSetupSession(result) || result.channel !== channel)
      throw new Error('配置会话无法核对')
    return result
  }

  /** 操作查询没有材料读取能力；返回必须与请求 ID 一致。 */
  async operation(id: string): Promise<CredentialOperation | null> {
    const result = await this.call('operation', { operationId: id })
    if (result === null) return null
    if (!isCredentialOperation(result) || result.id !== id) throw new Error('保存操作无法核对')
    return result
  }

  /** 有界停止；未完成状态由配置进程下次启动核对，不重放材料。 */
  async close(): Promise<void> {
    const child = this.child
    if (!child) return
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
      this.child = null
      this.failPending()
      return
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 4000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      child.kill('SIGTERM')
    })
  }
}
