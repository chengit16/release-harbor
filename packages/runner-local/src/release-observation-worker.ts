/** @description 固定状态查询 worker；私有 stdin 输入经版本与 nonce 校验，秘密不进入输出或日志。 */
import { isAbsolute } from 'node:path'
import { isRecord, hasExactKeys, type ReleaseObservationResult } from '@release-harbor/contracts'
import { credentialStore, profileRevision } from '@release-harbor/provider-app-ship'
import { observeMeizuRelease } from '../../provider-app-ship/src/meizu-status.ts'
import { observeHonorRelease } from '../../provider-app-ship/src/honor-status.ts'
import { isReleaseObservationJob } from './release-observation-protocol.ts'
async function main(): Promise<void> {
  // 1. 有界输入只允许宿主装配的目录与固定查询任务。
  let raw = ''
  for await (const chunk of process.stdin) {
    raw += String(chunk)
    if (Buffer.byteLength(raw) > 32768) throw Error()
  }
  const input: unknown = JSON.parse(raw)
  if (
    !isRecord(input) ||
    !hasExactKeys(input, ['schemaVersion', 'nonce', 'vaultPath', 'job']) ||
    input.schemaVersion !== 1 ||
    typeof input.nonce !== 'string' ||
    !/^[a-f0-9]{32}$/.test(input.nonce) ||
    typeof input.vaultPath !== 'string' ||
    !isAbsolute(input.vaultPath) ||
    !isReleaseObservationJob(input.job) ||
    !process.send
  )
    throw Error()
  let result: ReleaseObservationResult = {
    state: 'unknown',
    code: 'authentication',
    rawState: null,
  }
  try {
    // 2. 查询期间凭据目录变化则拒绝观察，不把混合材料结果当作可信状态。
    const revision = await profileRevision(input.vaultPath)
    const observe =
      input.job.binding.channel === 'meizu' ? observeMeizuRelease : observeHonorRelease
    result = await observe(credentialStore(input.vaultPath), input.job)
    if ((await profileRevision(input.vaultPath)) !== revision)
      result = { state: 'unknown', code: 'changed', rawState: null }
  } catch {
    /* 具体异常不得带出可信进程，只返回固定安全原因。 */
  }
  // 3. 回报仅包含 nonce 及安全状态，父进程再次校验关联。
  process.send({ schemaVersion: 1, nonce: input.nonce, result })
}
void main()
  .then(() => setTimeout(() => process.exit(0), 20))
  .catch(() => process.exit(1))
process.once('disconnect', () => process.exit(1))
