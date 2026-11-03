/** @description 独立本机检查进程入口，只读取私有 stdin 任务，不提供网络入口或发布动作。 */
import { inspectBoundArtifact } from './inspect.ts'
import { isInspectionTask, type InspectionOutcome } from './protocol.ts'

let input = ''
for await (const chunk of process.stdin) {
  input += chunk.toString()
  if (input.length > 16384) throw new Error('检查任务超出限制')
}
const task: unknown = JSON.parse(input)
if (!isInspectionTask(task)) throw new Error('检查任务格式不正确')
let outcome: InspectionOutcome
try {
  outcome = await inspectBoundArtifact(task)
} catch {
  outcome = { identity: null, failureCode: 'inspection_failed' }
}
// 输出最后一行带随机关联标识的安全投影，避免 SDK 普通日志被当成结果。
process.stdout.write(
  '\nHARBOR_RESULT:' +
    JSON.stringify({ nonce: task.nonce, artifactId: task.artifactId, ...outcome }) +
    '\n',
)
