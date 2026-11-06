/** @description 商店状态查询宿主；使用固定 worker 和 nonce 隔离平台凭据，超时只返回失败不自动重查。 */
import { fork, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  hasExactKeys,
  isRecord,
  isStoreStatusSnapshot,
  type StoreStatusSnapshot,
} from '@release-harbor/contracts'
import type { StoreStatusJob, StoreStatusRunner } from './store-status-protocol.ts'

/** 固定子进程只回传当前绑定的安全快照；超时不自动重试。 */
export class LocalStoreStatusRunner implements StoreStatusRunner {
  private children = new Set<ChildProcess>()
  private closed = false
  constructor(private readonly vaultPath: string) {}

  /** 通过私有 stdin 发送已恢复目标，忽略所有子进程标准输出。 */
  run(job: StoreStatusJob): Promise<StoreStatusSnapshot> {
    if (this.closed)
      return Promise.resolve({
        bindingId: job.binding.id,
        channel: job.binding.channel,
        checkedAt: new Date().toISOString(),
        code: 'network',
        versions: [],
      })
    return new Promise((resolve) => {
      const nonce = randomBytes(16).toString('hex'),
        child = fork(fileURLToPath(new URL('./store-status-worker.ts', import.meta.url)), [], {
          execArgv: ['--import', 'tsx'],
          stdio: ['pipe', 'ignore', 'ignore', 'ipc'],
          env: { PATH: process.env.PATH, HOME: process.env.HOME },
        })
      this.children.add(child)
      let ended = false
      const finish = (result: StoreStatusSnapshot): void => {
        if (ended) return
        ended = true
        clearTimeout(timer)
        this.children.delete(child)
        child.kill('SIGKILL')
        resolve(result)
      }
      const fallback = (): StoreStatusSnapshot => ({
        bindingId: job.binding.id,
        channel: job.binding.channel,
        checkedAt: new Date().toISOString(),
        code: 'network',
        versions: [],
      })
      const timer = setTimeout(() => finish(fallback()), 160000)
      child.once('exit', () => finish(fallback()))
      child.once('error', () => finish(fallback()))
      child.on('message', (value: unknown) => {
        if (
          isRecord(value) &&
          hasExactKeys(value, ['schemaVersion', 'nonce', 'result']) &&
          value.schemaVersion === 1 &&
          value.nonce === nonce &&
          isStoreStatusSnapshot(value.result) &&
          value.result.bindingId === job.binding.id &&
          value.result.channel === job.binding.channel
        )
          finish(value.result)
      })
      child.stdin?.on('error', () => finish(fallback()))
      child.stdin?.end(JSON.stringify({ schemaVersion: 1, nonce, vaultPath: this.vaultPath, job }))
    })
  }

  /** 宿主关闭后拒绝新任务并结束活动进程。 */
  close(): void {
    this.closed = true
    for (const child of this.children) child.kill('SIGKILL')
  }
}
