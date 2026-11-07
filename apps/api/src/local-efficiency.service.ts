/** @description 本机设置用例与生命周期；备份独占维护期，调度只读任务，恢复后由宿主重建服务。 */
import { DomainError } from '@release-harbor/domain'
import {
  isRecord,
  hasExactKeys,
  type LocalEfficiencyView,
  type RestorePreview,
  type LocalBackup,
} from '@release-harbor/contracts'
import { atomicLocal } from './local-files.ts'
import { join } from 'node:path'
import { LocalBackupService } from './local-backup.ts'
import { LocalMaintenance } from './local-maintenance.ts'
import { LocalStateStore } from './local-state-store.ts'
import { LocalTrackingService, addLocalNotice } from './local-tracking.service.ts'
import { RecoverySafety } from './recovery-safety.ts'

/** 装配仅接受本机可信依赖；没有自动发布、秘密导出或远程模式。 */
export class LocalEfficiencyService {
  private timer: ReturnType<typeof setInterval> | undefined
  private ticking = false
  private accountSessionUntil = 0
  constructor(
    readonly backups: LocalBackupService,
    readonly state: LocalStateStore,
    readonly tracking: LocalTrackingService,
    readonly maintenance: LocalMaintenance,
    private readonly safety: RecoverySafety,
    private readonly origins: readonly string[],
    private readonly accounts: {
      pause: () => Promise<void>
      resume: () => Promise<void>
      catalog: () => Promise<unknown>
    },
    private readonly restarted: () => void = () => {},
    private readonly now: () => number = Date.now,
  ) {}
  /** 来源头与精确 Origin 必需，不能被外部站点静默开启后台任务或恢复。 */
  assertSource(origin: unknown, marker: unknown): void {
    if (typeof origin !== 'string' || !this.origins.includes(origin) || marker !== '1')
      throw new DomainError('请从本机工作台明确操作', 403)
  }
  /** 开启配置会话后暂缓维护，独立配置端口不受普通 API 请求计数覆盖。 */
  accountSession(): void {
    this.accountSessionUntil = this.now() + 15 * 60000
  }
  /** GET 仅返回安全记录，不发商店请求。 */
  async view(): Promise<LocalEfficiencyView> {
    return {
      state: await this.state.read(),
      backups: await this.backups.list(),
      restarting: this.maintenance.restarting,
      recoveryReadOnly: await this.safety.isReadOnly(),
    }
  }
  /** 只接受已定义设置；通知权限仍由浏览器用户操作决定。 */
  async settings(body: unknown): Promise<void> {
    if (
      !isRecord(body) ||
      !hasExactKeys(body, ['autoBackup', 'browserNotifications', 'showApplicationName']) ||
      typeof body.autoBackup !== 'boolean' ||
      typeof body.browserNotifications !== 'boolean' ||
      typeof body.showApplicationName !== 'boolean'
    )
      throw new DomainError('设置格式不正确', 400)
    const autoBackup = body.autoBackup,
      browserNotifications = body.browserNotifications,
      showApplicationName = body.showApplicationName
    await this.state.change((s) => {
      s.autoBackup = autoBackup
      s.browserNotifications = browserNotifications
      s.showApplicationName = showApplicationName
    })
  }
  /** 维护前确认后台空闲并关闭独立配置进程；结束后重启配置服务，不保留秘密会话。 */
  private async maintain<T>(action: () => Promise<T>, ownRequest = 1): Promise<T> {
    return this.maintenance.exclusive(async () => {
      if (this.now() < this.accountSessionUntil)
        throw new DomainError('账号配置会话尚未结束，请十五分钟后再备份或恢复', 409)
      await this.backups.assertIdle()
      const accountMetadata = await this.accounts.catalog()
      await this.accounts.pause()
      try {
        await atomicLocal(join(this.backups.data, 'credential-metadata.json'), accountMetadata)
        return await action()
      } finally {
        if (!this.maintenance.restarting) await this.accounts.resume()
      }
    }, ownRequest)
  }
  /** 手动创建不会修改业务数据，失败保留旧备份。 */
  async backup(automatic = false): Promise<LocalBackup> {
    return this.maintain(
      async () => {
        const backup = await this.backups.create(automatic)
        await this.state.change((s) => {
          s.lastBackupAt = backup.createdAt
          s.lastBackupAttemptAt = backup.createdAt
          s.backupError = null
        })
        return backup
      },
      automatic ? 0 : 1,
    )
  }
  /** 大容器只用于白名单业务数据，预览不授予恢复或执行许可。 */
  async preview(body: unknown): Promise<RestorePreview> {
    if (!isRecord(body) || !hasExactKeys(body, ['backup']) || typeof body.backup !== 'string')
      throw new DomainError('请选择备份文件', 400)
    const backup = body.backup
    return this.maintain(() => this.backups.preview(backup))
  }
  /** 精确预览确认后切换启动指针，旧实例在重建前拒绝业务请求。 */
  async restore(body: unknown): Promise<void> {
    if (
      !isRecord(body) ||
      !hasExactKeys(body, ['id', 'digest', 'acknowledged']) ||
      typeof body.id !== 'string' ||
      typeof body.digest !== 'string' ||
      body.acknowledged !== true
    )
      throw new DomainError('请核对覆盖范围并明确确认恢复', 400)
    const id = body.id,
      digest = body.digest
    await this.maintain(async () => {
      await this.backups.restore(id, digest)
      this.maintenance.restarting = true
      setTimeout(() => this.restarted(), 250).unref()
    })
  }
  /** 只读保护摘要，恢复后依然可核对原目标。 */
  protections() {
    return this.safety.protections()
  }
  /** 仅追加人工声明，不清除其他已受理版本保护。 */
  reconcileProtection(body: unknown): Promise<void> {
    return this.safety.reconcile(body)
  }

  /** 已读不会完成待办；通知历史不重发。 */
  async readNotice(id: string): Promise<void> {
    await this.state.change((s) => {
      const n = s.notices.find((n) => n.id === id)
      if (!n) throw new DomainError('通知不存在', 404)
      n.read = true
    })
  }
  /** 受本机服务生命周期管理；关闭页面不停止服务，退出服务即停止。 */
  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.tick().catch(() => undefined)
    }, 30000)
    this.timer.unref()
  }
  /** 只停止新调度，已有任务由宿主正常关闭及维护门禁收尾。 */
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer)
  }
  /** 可控时钟用于休眠／重启验证；不集中补跑漏掉的周期。 */
  async tick(): Promise<void> {
    if (this.ticking || this.maintenance.locked || this.maintenance.restarting) return
    this.ticking = true
    try {
      const s = await this.state.read()
      if (
        s.autoBackup &&
        (!s.lastBackupAttemptAt || this.now() - Date.parse(s.lastBackupAttemptAt) >= 86400000)
      ) {
        try {
          await this.backup(true)
        } catch (error) {
          // 活动操作只推迟备份；基础设施失败按每日周期合并，避免每轮重复提醒。
          if (!(error instanceof DomainError && error.statusCode === 409))
            await this.state.change((state) => {
              state.backupError = '自动备份未完成，请检查存储空间与本机设置'
              state.lastBackupAttemptAt = new Date(this.now()).toISOString()
              addLocalNotice(
                state,
                `backup:${Math.floor(this.now() / 86400000)}`,
                '自动备份失败',
                state.backupError,
                undefined,
                this.now(),
              )
            })
        }
      }
      await this.tracking.tick()
    } finally {
      this.ticking = false
    }
  }
}
