/** @description 状态查询独立进程宿主；固定入口、有限期限、丢弃 stdout/stderr，不提供写许可或自动重试。 */
import { fork, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  isRecord,
  hasExactKeys,
  isReleaseObservationResult,
  type ReleaseObservationResult,
} from '@release-harbor/contracts'
import type {
  ReleaseObservationJob,
  ReleaseObservationRunner,
} from './release-observation-protocol.ts'
/** 同一宿主关闭后拒绝新任务；进程退出或超时只记录查询失败，不重放商店操作。 */
export class LocalReleaseObservationRunner implements ReleaseObservationRunner {
  private children = new Set<ChildProcess>()
  private closed = false
  constructor(private readonly vaultPath: string) {}
  run(job: ReleaseObservationJob): Promise<ReleaseObservationResult> {
    if (this.closed)
      return Promise.resolve({ state: 'unknown', code: 'interrupted', rawState: null })
    return new Promise((resolve) => {
      const nonce = randomBytes(16).toString('hex')
      const child = fork(
        fileURLToPath(new URL('./release-observation-worker.ts', import.meta.url)),
        [],
        {
          execArgv: ['--import', 'tsx'],
          stdio: ['pipe', 'ignore', 'ignore', 'ipc'],
          env: { PATH: process.env.PATH, HOME: process.env.HOME },
        },
      )
      this.children.add(child)
      let ended = false
      const finish = (result: ReleaseObservationResult): void => {
        if (ended) return
        ended = true
        clearTimeout(timer)
        child.kill('SIGKILL')
        resolve(result)
      }
      const timer = setTimeout(
        () => finish({ state: 'unknown', code: 'network', rawState: null }),
        160000,
      )
      child.once('exit', () => {
        this.children.delete(child)
        finish({ state: 'unknown', code: 'interrupted', rawState: null })
      })
      child.once('error', () => {
        this.children.delete(child)
        finish({ state: 'unknown', code: 'interrupted', rawState: null })
      })
      child.on('message', (value: unknown) => {
        if (
          isRecord(value) &&
          hasExactKeys(value, ['schemaVersion', 'nonce', 'result']) &&
          value.schemaVersion === 1 &&
          value.nonce === nonce &&
          isReleaseObservationResult(value.result)
        )
          finish(value.result)
      })
      child.stdin?.on('error', () =>
        finish({ state: 'unknown', code: 'interrupted', rawState: null }),
      )
      child.stdin?.end(JSON.stringify({ schemaVersion: 1, nonce, vaultPath: this.vaultPath, job }))
    })
  }
  /** 仅停止本机只读查询，不更改发布任务或远端状态。 */
  close(): void {
    this.closed = true
    for (const child of this.children) child.kill('SIGKILL')
  }
}
