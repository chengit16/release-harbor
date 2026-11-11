/** @description 单进程维护准入；阻止新 HTTP 与定时任务，等待已有后台事实完成后才允许快照。 */
import { DomainError } from '@release-harbor/domain'
/** 请求与后台任务共享维护状态；不冒充跨进程锁。 */
export class LocalMaintenance {
  requests = 0
  tasks = 0
  locked = false
  restarting = false
  /** 共享占用允许无冲突任务并行，独占维护须等待占用结束，避免快照不一致或写回旧数据代。 */
  async task<T>(action: () => Promise<T>): Promise<T> {
    if (this.locked || this.restarting) throw new DomainError('本机正在维护，请稍后重试', 409)
    this.tasks++
    try {
      return await action()
    } finally {
      this.tasks--
    }
  }
  /** HTTP 操作本身允许一个请求；自动备份要求没有任何活动请求。 */
  async exclusive<T>(action: () => Promise<T>, ownRequest = 1): Promise<T> {
    if (this.locked || this.restarting || this.tasks || this.requests > ownRequest)
      throw new DomainError('本机有活动操作，请稍后进行备份或恢复', 409)
    this.locked = true
    try {
      return await action()
    } finally {
      this.locked = false
    }
  }
}
