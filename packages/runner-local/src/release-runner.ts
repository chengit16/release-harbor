/** @description 发布子进程宿主；标准输出和错误直接丢弃，固定安全 IPC 握手控制首次远端写入。 */
import { fork, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  isExecutionDiagnostic,
  type ExecutionDiagnostic,
  isRecord,
  hasExactKeys,
  type ReleasePlan,
  type AttemptResult,
} from '@release-harbor/contracts'
import { isAttemptResult, type ReleaseExecutor } from './release-protocol.ts'

/** 30 分钟硬上限；结束本地进程并不撤回远端上传，所有异常交由持久化许可事实判断。 */
export class LocalReleaseExecutor implements ReleaseExecutor {
  private readonly children = new Set<ChildProcess>()
  constructor(
    private readonly storageRoot: string,
    private readonly vaultPath: string,
  ) {}
  /** 只接受服务端计划，路径来自启动配置；许可仅由控制面持久化后授予一次。 */
  run(
    plan: ReleasePlan,
    attemptId: string,
    beforeRemote: () => Promise<void>,
    onDiagnostic: (code: ExecutionDiagnostic) => void = () => undefined,
  ): Promise<AttemptResult> {
    return new Promise((resolve) => {
      const nonce = randomBytes(16).toString('hex')
      const child = fork(fileURLToPath(new URL('./release-worker.ts', import.meta.url)), [], {
        execArgv: ['--import', 'tsx'],
        stdio: ['pipe', 'ignore', 'ignore', 'ipc'],
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          ANDROID_HOME: process.env.ANDROID_HOME,
          ANDROID_SDK_ROOT: process.env.ANDROID_SDK_ROOT,
        },
      })
      this.children.add(child)
      let ended = false
      let requested = false
      let granted = false
      const timer = setTimeout(
        () => {
          onDiagnostic('runner_interrupted')
          finish('interrupted')
        },
        30 * 60 * 1000,
      )
      function finish(result: AttemptResult): void {
        if (ended) return
        ended = true
        clearTimeout(timer)
        child.kill('SIGKILL')
        resolve(result)
      }
      child.once('exit', () => {
        this.children.delete(child)
        if (!ended) onDiagnostic('runner_interrupted')
        finish('interrupted')
      })
      child.once('error', () => {
        this.children.delete(child)
        if (!ended) onDiagnostic('runner_interrupted')
        finish('interrupted')
      })
      child.on('message', (value: unknown) => {
        if (ended || !isRecord(value) || value.schemaVersion !== 1 || value.nonce !== nonce) return
        if (
          value.action === 'permit' &&
          hasExactKeys(value, ['schemaVersion', 'nonce', 'action']) &&
          !requested
        ) {
          requested = true
          void beforeRemote()
            .then(() => {
              if (ended || !child.connected) return
              granted = true
              child.send({ schemaVersion: 1, nonce, action: 'grant' }, (error) => {
                if (error) finish('interrupted')
              })
            })
            .catch(() => {
              onDiagnostic('authorization_changed')
              finish('verification_failed')
            })
        } else if (
          value.action === 'diagnostic' &&
          hasExactKeys(value, ['schemaVersion', 'nonce', 'action', 'diagnostic']) &&
          isExecutionDiagnostic(value.diagnostic)
        ) {
          onDiagnostic(value.diagnostic)
        } else if (
          value.action === 'result' &&
          hasExactKeys(value, ['schemaVersion', 'nonce', 'action', 'result']) &&
          isAttemptResult(value.result)
        ) {
          finish(
            (value.result === 'draft_saved' ||
              value.result === 'review_submitted' ||
              value.result === 'oppo_version_processed' ||
              value.result === 'vivo_update_accepted' ||
              value.result === 'meizu_review_submitted' ||
              value.result === 'honor_review_submitted') &&
              !granted
              ? 'verification_failed'
              : value.result,
          )
        }
      })
      child.stdin?.on('error', () => finish('interrupted'))
      child.stdin?.end(
        JSON.stringify({
          schemaVersion: 1,
          nonce,
          attemptId,
          plan,
          storageRoot: this.storageRoot,
          vaultPath: this.vaultPath,
        }),
      )
    })
  }
  /** 服务退出杀死本地 worker，持久化层将已开始的远端操作标记待核对。 */
  close(): void {
    for (const child of this.children) child.kill('SIGKILL')
  }
}
