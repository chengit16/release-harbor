/** @description 发布子进程宿主；标准输出和错误直接丢弃，固定安全 IPC 握手控制首次远端写入。 */
import { fork, type ChildProcess } from 'node:child_process'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  isExecutionDiagnostic,
  isBatchTargetValidation,
  type BatchTargetValidation,
  type ExecutionDiagnostic,
  isRecord,
  hasExactKeys,
  type ReleasePlan,
  type AttemptResult,
} from '@release-harbor/contracts'
import { isAttemptResult, type ReleaseExecutor, type BatchExecution } from './release-protocol.ts'

/** 30 分钟硬上限；结束本地进程并不撤回远端上传，所有异常交由持久化许可事实判断。 */
export class LocalReleaseExecutor implements ReleaseExecutor {
  private closed = false
  private readonly children = new Set<ChildProcess>()
  constructor(
    private readonly storageRoot: string,
    private readonly vaultPath: string,
  ) {}
  /** 只接受服务端计划，路径来自启动配置；许可仅由控制面持久化后授予一次。 */
  async run(
    plan: ReleasePlan,
    attemptId: string,
    beforeRemote: (proof?: BatchTargetValidation) => Promise<void>,
    onDiagnostic: (code: ExecutionDiagnostic) => void = () => undefined,
    batch?: BatchExecution,
  ): Promise<AttemptResult> {
    if (this.closed) return 'interrupted'
    const created = await mkdtemp(join(tmpdir(), 'release-harbor-runtime-'))
    try {
      const runtimeRoot = await realpath(created)
      if (this.closed) return 'interrupted'
      return await new Promise<AttemptResult>((resolve) => {
        const nonce = randomBytes(16).toString('hex')
        const child = fork(fileURLToPath(new URL('./release-worker.ts', import.meta.url)), [], {
          execArgv: ['--import', 'tsx'],
          detached: true,
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
        let outcome: AttemptResult = 'interrupted'
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
          outcome = result
          killGroup(child)
        }
        child.once('exit', () => finish('interrupted'))
        child.once('close', () => {
          this.children.delete(child)
          clearTimeout(timer)
          resolve(outcome)
        })
        child.once('error', () => {
          this.children.delete(child)
          finish('interrupted')
        })
        child.on('message', (value: unknown) => {
          if (ended || !isRecord(value) || value.schemaVersion !== 1 || value.nonce !== nonce)
            return
          if (
            value.action === 'permit' &&
            hasExactKeys(value, [
              'schemaVersion',
              'nonce',
              'action',
              ...(batch ? ['proof'] : []),
            ]) &&
            (!batch || isBatchTargetValidation(value.proof)) &&
            !requested
          ) {
            requested = true
            void beforeRemote(isBatchTargetValidation(value.proof) ? value.proof : undefined)
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
              [
                'draft_saved',
                'build_uploaded',
                'build_available',
                'build_processing',
                'review_submitted',
                'oppo_version_processed',
                'vivo_update_accepted',
                'meizu_review_submitted',
                'honor_review_submitted',
                'tencent_review_submitted',
                'harmony_review_submitted',
              ].includes(value.result) && !granted
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
            runtimeRoot,
            attemptId,
            plan,
            ...(batch ? { batch } : {}),
            storageRoot: this.storageRoot,
            vaultPath: this.vaultPath,
          }),
        )
      })
    } finally {
      await rm(created, { recursive: true, force: true })
    }
  }
  /** 服务退出杀死本地 worker，持久化层将已开始的远端操作标记待核对。 */
  close(): void {
    this.closed = true
    for (const child of this.children) killGroup(child)
  }
}

/** worker 与 altool 共享进程组，停止本地等待时必须一并结束，才能清理其私钥文件。 */
function killGroup(child: ChildProcess): void {
  try {
    if (child.pid) process.kill(-child.pid, 'SIGKILL')
  } catch {
    child.kill('SIGKILL')
  }
}
