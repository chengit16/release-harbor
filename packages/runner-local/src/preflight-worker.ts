/** @description 私有 stdin 请求入口，不接收 shell 参数中的凭据，不输出原始商店日志。 */
import { profileCatalog } from '@release-harbor/provider-app-ship'
import { isPreflightTask } from './preflight-protocol.ts'
import { checkPreflight } from './check-preflight.ts'

try {
  let input = ''
  for await (const chunk of process.stdin) {
    input += String(chunk)
    if (Buffer.byteLength(input) > 16 * 1024) throw new Error('请求过大')
  }
  const task: unknown = JSON.parse(input)
  if (!isPreflightTask(task)) throw new Error('无效任务')
  const result =
    task.action === 'catalog' ? await profileCatalog(task.vaultPath) : await checkPreflight(task)
  process.stdout.write('HARBOR_PREFLIGHT:' + JSON.stringify({ nonce: task.nonce, result }) + '\n')
} catch {
  // 不传播包含本机路径、Keychain 或商店原文的异常。
  process.exitCode = 1
}
