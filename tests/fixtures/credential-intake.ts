/** @description 只供测试使用的本机配置端口，真实 HTTP 和 SDK 加密配合内存安全库，永不访问真实 Keychain。 */
import { join } from 'node:path'
import {
  localCredentialRepository,
  type CredentialRepository,
} from '../../packages/provider-app-ship/src/index.ts'
import { CredentialAccountStore } from '../../packages/runner-local/src/credential-account-store.ts'
import { CredentialIntakeEngine } from '../../packages/runner-local/src/credential-intake-engine.ts'
import { CredentialIntakeServer } from '../../packages/runner-local/src/credential-intake-server.ts'
import type { CredentialIntake } from '../../packages/runner-local/src/index.ts'
import type {
  BindingChannel,
  CredentialReplacement,
  CredentialAccountAction,
} from '../../packages/contracts/src/index.ts'

/** 合成材料只留在测试进程内存，SDK 文件加密和元数据仍使用实际实现。 */
export class MemoryCredentialSecrets {
  readonly values = new Map<string, string>()
  async getSecret(account: string): Promise<string | undefined> {
    return this.values.get(account)
  }
  async setSecret(account: string, value: string): Promise<void> {
    this.values.set(account, value)
  }
  async deleteSecret(account: string): Promise<boolean> {
    return this.values.delete(account)
  }
}

/** 通过显式依赖注入使用，不允许由生产环境变量启用模拟存储。 */
export class TestCredentialIntake implements CredentialIntake {
  readonly repository: CredentialRepository
  readonly store: CredentialAccountStore
  readonly engine: CredentialIntakeEngine
  readonly server: CredentialIntakeServer
  constructor(
    root: string,
    origins: string[],
    repository?: CredentialRepository,
    now?: () => number,
  ) {
    this.repository =
      repository ??
      localCredentialRepository(
        join(root, 'credentials', 'profiles.json'),
        new MemoryCredentialSecrets(),
      )
    this.store = new CredentialAccountStore(join(root, 'credential-accounts.json'))
    this.engine = new CredentialIntakeEngine(this.store, this.repository, now)
    this.server = new CredentialIntakeServer(this.engine, origins)
  }
  async start(): Promise<void> {
    await this.server.start()
  }
  accounts() {
    return this.engine.accounts()
  }
  session(channel: BindingChannel, origin: string, replacement?: CredentialReplacement) {
    return this.engine.createSession(channel, origin, this.server.endpoint, replacement)
  }
  manage(input: CredentialAccountAction) {
    return this.engine.manage(input)
  }
  operation(id: string) {
    return this.engine.operation(id)
  }
  async close(): Promise<void> {
    await this.server.close()
  }
}
