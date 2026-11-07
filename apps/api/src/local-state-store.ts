/** @description 跟踪与通知共用原子状态；一次观察结果和对应事件一起保存，避免永久漏报。 */
import { DomainError } from '@release-harbor/domain'
import { isLocalEfficiencyState, type LocalEfficiencyState } from '@release-harbor/contracts'
import { atomicLocal, readLocal } from './local-files.ts'

/** 初始禁用自动任务，不恢复浏览器权限或发布授权。 */
export function emptyLocalState(): LocalEfficiencyState {
  return {
    schemaVersion: 1,
    autoBackup: false,
    lastBackupAt: null,
    lastBackupAttemptAt: null,
    backupError: null,
    browserNotifications: false,
    showApplicationName: false,
    follows: [],
    notices: [],
  }
}
/** 单进程队列，损坏拒写；调用方必须遵守全局维护门禁。 */
export class LocalStateStore {
  private pending: Promise<unknown> = Promise.resolve()
  constructor(private readonly file: string) {}
  /** GET 只读，不因访问自动初始化文件。 */
  async read(): Promise<LocalEfficiencyState> {
    await this.pending
    return this.load()
  }
  private async load(): Promise<LocalEfficiencyState> {
    const raw = await readLocal(this.file)
    if (raw === null) return emptyLocalState()
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch {
      throw new DomainError('本机设置损坏，请检查备份', 503)
    }
    if (!isLocalEfficiencyState(value)) throw new DomainError('本机设置格式不受支持', 503)
    return value
  }
  /** 事件与任务状态同文件提交，返回值不共享存储内部对象。 */
  change<T>(action: (state: LocalEfficiencyState) => T): Promise<T> {
    const task = this.pending.then(async () => {
      const state = await this.load()
      const result = action(state)
      if (!isLocalEfficiencyState(state)) throw Error('无效本机设置变更')
      await atomicLocal(this.file, state)
      return structuredClone(result)
    })
    this.pending = task.catch(() => undefined)
    return task
  }
}
