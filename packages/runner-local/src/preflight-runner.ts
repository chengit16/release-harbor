/** @description 只读核验子进程宿主；控制面只接收固定安全结果，不加载 SDK 或凭据材料。 */
import { execFile, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { isProfileCatalog, isRecord, type ProfileCatalog } from '@release-harbor/contracts'
import {
  isPreflightOutcome,
  type PreflightOutcome,
  type PreflightTask,
} from './preflight-protocol.ts'

export type { PreflightOutcome, PreflightTask } from './preflight-protocol.ts'

/** 测试可注入内存端口；真实实现只运行仓库 worker，不能由客户端选择命令。 */
export interface PreflightRunner {
  catalog(): Promise<ProfileCatalog>
  check(task: Extract<PreflightTask, { action: 'preflight' }>): Promise<PreflightOutcome>
  close(): void
}

/** 公开错误常量不携带 worker 的 stderr 或异常原文。 */
export const unavailablePreflight: PreflightOutcome = {
  code: 'runner_unavailable',
  artifact: 'unverified',
  authentication: 'unverified',
  target: 'unverified',
}

/** 60 秒硬上限含本机字节复核；SDK 网络阶段另有 20 秒上限。 */
export class LocalPreflightRunner implements PreflightRunner {
  private readonly children = new Set<ChildProcess>()
  constructor(private readonly vaultPath: string) {}

  /** 目录请求无需凭据访问，不会因用户打开页面而鉴权。 */
  async catalog(): Promise<ProfileCatalog> {
    const value = await this.run({
      schemaVersion: 1,
      action: 'catalog',
      nonce: randomBytes(16).toString('hex'),
      vaultPath: this.vaultPath,
    })
    return isProfileCatalog(value) ? value : { code: 'storage_unavailable', profiles: [] }
  }

  /** 私有路径始终由启动配置覆盖；安全投影后才能返回控制面。 */
  async check(task: Extract<PreflightTask, { action: 'preflight' }>): Promise<PreflightOutcome> {
    const value = await this.run({ ...task, vaultPath: this.vaultPath })
    return isPreflightOutcome(value)
      ? {
          code: value.code,
          artifact: value.artifact,
          authentication: value.authentication,
          target: value.target,
          ...(value.xiaomi ? { xiaomi: value.xiaomi } : {}),
          ...(value.meizu ? { meizu: value.meizu } : {}),
          ...(value.honor ? { honor: value.honor } : {}),
          ...(value.tencent ? { tencent: value.tencent } : {}),
          ...(value.harmony ? { harmony: value.harmony } : {}),
          ...(value.huawei ? { huawei: value.huawei } : {}),
          ...(value.vivo ? { vivo: value.vivo } : {}),
          ...(value.oppo ? { oppo: value.oppo } : {}),
        }
      : { ...unavailablePreflight }
  }

  private run(task: PreflightTask): Promise<unknown> {
    return new Promise((resolve) => {
      const child = execFile(
        process.execPath,
        ['--import', 'tsx', fileURLToPath(new URL('./preflight-worker.ts', import.meta.url))],
        {
          timeout: 60_000,
          killSignal: 'SIGKILL',
          maxBuffer: 512 * 1024,
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            ANDROID_HOME: process.env.ANDROID_HOME,
            ANDROID_SDK_ROOT: process.env.ANDROID_SDK_ROOT,
          },
        },
        (error, stdout) => {
          this.children.delete(child)
          if (error) return resolve(null)
          try {
            const line = stdout.trim().split('\n').at(-1)
            if (!line?.startsWith('HARBOR_PREFLIGHT:')) return resolve(null)
            const value: unknown = JSON.parse(line.slice('HARBOR_PREFLIGHT:'.length))
            resolve(
              isRecord(value) && Object.keys(value).length === 2 && value.nonce === task.nonce
                ? value.result
                : null,
            )
          } catch {
            resolve(null)
          }
        },
      )
      this.children.add(child)
      child.stdin?.on('error', () => {
        /* 提前退出统一由回调投影，不输出原始异常。 */
      })
      child.stdin?.end(JSON.stringify(task))
    })
  }

  /** 退出不重试；未完成的持久化记录恢复为中断。 */
  close(): void {
    for (const child of this.children) child.kill('SIGKILL')
  }
}
