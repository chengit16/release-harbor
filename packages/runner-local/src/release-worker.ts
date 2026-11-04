/** @description 固定发布 worker：有界私有 stdin，nonce 关联许可握手；标准输出和异常不承载公开回执。 */
import { isRecord, hasExactKeys } from '@release-harbor/contracts'
import { isReleaseTask } from './release-protocol.ts'
import { runRelease } from './run-release.ts'

async function main(): Promise<void> {
  let raw = ''
  for await (const chunk of process.stdin) {
    raw += String(chunk)
    if (Buffer.byteLength(raw) > 512 * 1024) throw new Error('输入超限')
  }
  const parsed: unknown = JSON.parse(raw)
  if (!isReleaseTask(parsed) || !process.send) throw new Error('无效任务')
  const task = parsed
  const envelope = (action: string, extra = {}) => ({
    schemaVersion: 1,
    nonce: task.nonce,
    action,
    ...extra,
  })
  const result = await runRelease(
    task,
    () =>
      new Promise<void>((resolve, reject) => {
        // 父进程断开或许可超时即停止；不使用 PID、计划 ID 或旧消息充当许可。
        const timer = setTimeout(() => done(false), 60000)
        function done(granted: boolean): void {
          clearTimeout(timer)
          process.off('message', message)
          process.off('disconnect', disconnected)
          if (granted) resolve()
          else reject(new Error('未获许可'))
        }
        function disconnected(): void {
          done(false)
        }
        function message(value: unknown): void {
          if (
            isRecord(value) &&
            hasExactKeys(value, ['schemaVersion', 'nonce', 'action']) &&
            value.schemaVersion === 1 &&
            value.nonce === task.nonce &&
            value.action === 'grant'
          )
            done(true)
        }
        process.on('message', message)
        process.once('disconnect', disconnected)
        process.send?.(envelope('permit'))
      }),
    (diagnostic) => process.send?.(envelope('diagnostic', { diagnostic })),
  )
  process.send?.(envelope('result', { result }), undefined, undefined, () => process.exit(0))
}
void main().catch(() => process.exit(1))
