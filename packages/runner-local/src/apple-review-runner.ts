/** @description Apple 审核子进程宿主；固定入口与私有 stdin，标准输出丢弃，许可持久化后才授予写权。 */
import { fork, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { isRecord, hasExactKeys } from '@release-harbor/contracts'
import {
  isAppleReviewReply,
  type AppleReviewJob,
  type AppleReviewReply,
  type AppleReviewRunner,
} from './apple-review-protocol.ts'
/** 查询和执行都在独立 worker；关闭不撤销远端已开始的操作，不自动重试。 */
export class LocalAppleReviewRunner implements AppleReviewRunner {
  private children = new Set<ChildProcess>()
  private closed = false
  constructor(private readonly vaultPath: string) {}
  async run(job: AppleReviewJob, permit?: () => Promise<void>): Promise<AppleReviewReply> {
    if (this.closed) return { ok: false, code: 'interrupted' }
    return new Promise((resolve) => {
      const nonce = randomBytes(16).toString('hex')
      const child = fork(fileURLToPath(new URL('./apple-review-worker.ts', import.meta.url)), [], {
        execArgv: ['--import', 'tsx'],
        stdio: ['pipe', 'ignore', 'ignore', 'ipc'],
        env: { PATH: process.env.PATH, HOME: process.env.HOME },
      })
      this.children.add(child)
      let ended = false,
        requested = false,
        granted = false
      const finish = (reply: AppleReviewReply): void => {
        if (ended) return
        ended = true
        clearTimeout(timer)
        child.kill('SIGKILL')
        resolve(reply)
      }
      const timer = setTimeout(() => finish({ ok: false, code: 'network' }), 300000)
      child.once('exit', () => {
        this.children.delete(child)
        finish({ ok: false, code: 'interrupted' })
      })
      child.once('error', () => {
        this.children.delete(child)
        finish({ ok: false, code: 'interrupted' })
      })
      child.on('message', (v: unknown) => {
        if (
          ended ||
          !isRecord(v) ||
          !hasExactKeys(v, ['schemaVersion', 'nonce', 'action', 'value']) ||
          v.schemaVersion !== 1 ||
          v.nonce !== nonce
        )
          return
        if (
          v.action === 'permit' &&
          v.value === null &&
          !requested &&
          job.kind === 'execute' &&
          permit
        ) {
          requested = true
          void permit()
            .then(() => {
              if (ended || !child.connected) return
              granted = true
              child.send({ schemaVersion: 1, nonce, action: 'grant' })
            })
            .catch(() => finish({ ok: false, code: 'changed' }))
        }
        if (v.action === 'result' && isAppleReviewReply(v.value)) {
          const reply = v.value
          if (reply.ok) {
            const valid =
              job.kind === 'execute'
                ? granted &&
                  reply.value ===
                    (job.snapshot.action === 'submit' ? 'submitted' : 'release_requested')
                : typeof reply.value !== 'string'
            if (!valid) {
              finish({ ok: false, code: 'receipt' })
              return
            }
          }
          finish(reply)
        }
      })
      child.stdin?.on('error', () => finish({ ok: false, code: 'interrupted' }))
      child.stdin?.end(JSON.stringify({ schemaVersion: 1, nonce, vaultPath: this.vaultPath, job }))
    })
  }
  /** 只结束本机等待，许可后的未知结果由持久化事实恢复。 */
  close(): void {
    this.closed = true
    for (const child of this.children) child.kill('SIGKILL')
  }
}
