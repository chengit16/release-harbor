/** @description macOS 安全库适配，绕过 SDK 密码提示的长输入截断；秘密只走私有管道且写后核对。 */
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { isRecord } from '@release-harbor/contracts'
import type { SecretStore } from '@huoye/app-ship'

/** 原生桥接仅返回当前动作结果，不输出原始 stderr、命令正文或异常内容。 */
export class NativeKeychainSecrets implements SecretStore {
  constructor(private readonly service = 'release-harbor') {}

  private call(
    action: 'get' | 'set' | 'delete',
    account: string,
    secret?: string,
  ): Promise<{
    status: number
    secret?: string
  }> {
    return new Promise((resolve, reject) => {
      const fail = (): void => reject(new Error('本机钥匙串操作未完成，请检查系统授权后重新核对'))
      const child = execFile(
        '/usr/bin/osascript',
        ['-l', 'JavaScript', fileURLToPath(new URL('./keychain-bridge.js', import.meta.url))],
        { timeout: 12000, killSignal: 'SIGKILL', maxBuffer: 256 * 1024 },
        (error, stdout) => {
          if (error) return fail()
          try {
            const result: unknown = JSON.parse(stdout)
            if (
              !isRecord(result) ||
              typeof result.status !== 'number' ||
              !Number.isInteger(result.status) ||
              (result.status !== 0 && result.status !== -25300)
            )
              return fail()
            resolve({
              status: result.status,
              secret: typeof result.secret === 'string' ? result.secret : undefined,
            })
          } catch {
            fail()
          }
        },
      )
      child.stdin?.on('error', () => {
        /* 提前退出由回调统一脱敏，绝不转发包含秘密的进程异常。 */
      })
      child.stdin?.end(JSON.stringify({ action, service: this.service, account, secret }))
    })
  }

  /** 只在可信进程内解析材料；不存在与系统拒绝访问分别处理。 */
  async getSecret(account: string): Promise<string | undefined> {
    const result = await this.call('get', account)
    if (result.status === -25300) return undefined
    if (result.secret === undefined) throw new Error('钥匙串材料无法读取')
    return result.secret
  }

  /** 不以系统命令退出成功代替完整保存；包括 Vault 主密钥在内都必须完整读回。 */
  async setSecret(account: string, secret: string): Promise<void> {
    const result = await this.call('set', account, secret)
    if (result.status !== 0 || (await this.getSecret(account)) !== secret)
      throw new Error('钥匙串保存后核对失败')
  }

  /** 只删除显式指定的产品账号，不删除共享 Vault 主密钥。 */
  async deleteSecret(account: string): Promise<boolean> {
    return (await this.call('delete', account)).status === 0
  }
}
