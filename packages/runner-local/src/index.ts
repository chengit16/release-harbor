/** @description 本机检查子进程宿主，API 只调用此隔离边界，不在控制面加载 SDK。 */
import { execFile, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  artifactFailureMessages,
  artifactLimits,
  isArtifactIdentity,
  isRecord,
} from '@release-harbor/contracts'
import type { InspectionTask, InspectionOutcome } from './protocol.ts'

export {
  LocalPreflightRunner,
  unavailablePreflight,
  type PreflightRunner,
  type PreflightTask,
  type PreflightOutcome,
} from './preflight-runner.ts'
export { isPreflightOutcome } from './preflight-protocol.ts'

export type { InspectionTask, InspectionOutcome } from './protocol.ts'

/** 检查端口允许测试注入故障，正常启动使用真实子进程。 */
export interface ArtifactInspector {
  inspect(task: InspectionTask): Promise<InspectionOutcome>
  close(): void
}

/** 固定执行仓库内 worker，使用私有 stdin 与 nonce 绑定请求／回报，不执行 shell 插值。 */
export class LocalArtifactInspector implements ArtifactInspector {
  private readonly children = new Set<ChildProcess>()

  /** 只继承检查工具需要的环境；原始输出有界且不写入应用日志。 */
  inspect(task: InspectionTask): Promise<InspectionOutcome> {
    return new Promise((resolve) => {
      const child = execFile(
        process.execPath,
        ['--import', 'tsx', fileURLToPath(new URL('./worker.ts', import.meta.url))],
        {
          timeout: artifactLimits.inspectionTimeoutMs,
          killSignal: 'SIGKILL',
          maxBuffer: 64 * 1024,
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            ANDROID_HOME: process.env.ANDROID_HOME,
            ANDROID_SDK_ROOT: process.env.ANDROID_SDK_ROOT,
          },
        },
        (error, stdout) => {
          this.children.delete(child)
          if (error) {
            resolve({ identity: null, failureCode: 'inspection_failed' })
            return
          }
          try {
            const line = stdout.trim().split('\n').at(-1)
            if (!line?.startsWith('HARBOR_RESULT:')) throw new Error('missing result')
            const result: unknown = JSON.parse(line.slice('HARBOR_RESULT:'.length))
            if (
              !isRecord(result) ||
              Object.keys(result).length !== 4 ||
              result.nonce !== task.nonce ||
              result.artifactId !== task.artifactId ||
              (result.identity !== null && !isArtifactIdentity(result.identity)) ||
              (result.failureCode !== null &&
                (typeof result.failureCode !== 'string' ||
                  !Object.hasOwn(artifactFailureMessages, result.failureCode)))
            )
              throw new Error('invalid result')
            if (result.failureCode === null && !isArtifactIdentity(result.identity))
              throw new Error('missing identity')
            // 经过合同守卫后再构造安全投影，不让原始对象逃出执行进程。
            const checked = isArtifactIdentity(result.identity) ? result.identity : null
            const identity = checked
              ? {
                  format: checked.format,
                  packageName: checked.packageName,
                  versionName: checked.versionName,
                  buildNumber: checked.buildNumber,
                  sizeBytes: checked.sizeBytes,
                  sha256: checked.sha256,
                }
              : null
            resolve({
              identity,
              failureCode: isFailureCode(result.failureCode) ? result.failureCode : null,
            })
          } catch {
            resolve({ identity: null, failureCode: 'inspection_failed' })
          }
        },
      )
      this.children.add(child)
      child.stdin?.on('error', () => {
        /* 子进程提前退出由 execFile 回调统一投影为失败。 */
      })
      child.stdin?.end(JSON.stringify(task))
    })
  }

  /** 服务退出时终止尚未完成的检查，下次启动按中断恢复，不自动重跑。 */
  close(): void {
    for (const child of this.children) child.kill('SIGKILL')
  }
}

function isFailureCode(key: unknown): key is keyof typeof artifactFailureMessages {
  return typeof key === 'string' && Object.hasOwn(artifactFailureMessages, key)
}
