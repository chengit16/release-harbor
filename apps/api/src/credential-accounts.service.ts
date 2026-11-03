/** @description 账号控制面只管理会话及安全目录，材料 HTTP 独立运行，不在 NestJS 内解析或代理。 */
import {
  isRecord,
  type CredentialAccounts,
  type CredentialOperation,
} from '@release-harbor/contracts'
import { DomainError, type ApplicationStore, type ProjectStore } from '@release-harbor/domain'
import type { CredentialIntake, CredentialSetupSession } from '@release-harbor/runner-local'

/** local 工作空间固定，公开输入不能携带材料或指定来源。 */
export class CredentialAccountsService {
  constructor(
    private readonly intake: CredentialIntake,
    private readonly origins: readonly string[],
    private readonly projects: ProjectStore,
    private readonly applications: ApplicationStore,
  ) {}

  /** 随服务自动启动独立配置进程。 */
  async onModuleInit(): Promise<void> {
    await this.intake.start()
  }
  /** 终止当前配置进程，不自动重放保存请求。 */
  async onModuleDestroy(): Promise<void> {
    await this.intake.close()
  }

  /** 关联数量由可信绑定数据计算，目录可读不等于鉴权有效。 */
  async catalog(): Promise<CredentialAccounts> {
    const catalog = await this.intake.accounts().catch(() => {
      throw new DomainError('商店账号目录暂不可用，请检查本机配置服务', 503)
    })
    const usage = new Map<string, Set<string>>()
    for (const project of await this.projects.list('local')) {
      for (const application of await this.applications.list('local', project.id)) {
        for (const binding of await this.applications.listBindings(
          'local',
          project.id,
          application.id,
        )) {
          const key = `${binding.channel}:${binding.credentialReference}`
          const used = usage.get(key) ?? new Set<string>()
          used.add(application.id)
          usage.set(key, used)
        }
      }
    }
    return {
      ...catalog,
      accounts: catalog.accounts.map((account) => ({
        ...account,
        applicationCount: usage.get(`${account.channel}:${account.reference}`)?.size ?? 0,
      })),
    }
  }

  /** 来源由 HTTP 头与启动白名单核对，正文只接受渠道，不能混入秘密。 */
  async session(input: unknown, origin: unknown, marker: unknown): Promise<CredentialSetupSession> {
    if (typeof origin !== 'string' || !this.origins.includes(origin) || marker !== '1')
      throw new DomainError('请从本机工作台打开账号配置向导', 403)
    if (
      !isRecord(input) ||
      Object.keys(input).length !== 1 ||
      (input.channel !== 'huawei' && input.channel !== 'app_store')
    )
      throw new DomainError('仅允许选择华为或 Apple 渠道，不接受凭据材料')
    return this.intake.session(input.channel, origin).catch(() => {
      throw new DomainError('本机配置会话未能创建，请重新打开或检查存储状态', 503)
    })
  }

  /** 只取得可信本机保存结果，不读取材料；未知操作明确返回不存在。 */
  async operation(id: string): Promise<CredentialOperation> {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new DomainError('保存操作不存在', 404)
    const result = await this.intake.operation(id).catch(() => {
      throw new DomainError('保存结果暂时无法核对，请稍后重新读取', 503)
    })
    if (!result) throw new DomainError('保存操作不存在', 404)
    return result
  }
}
