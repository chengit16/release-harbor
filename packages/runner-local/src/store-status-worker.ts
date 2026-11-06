/** @description 商店状态可信 worker；在独立进程解析凭据并访问固定官方只读接口，输出仅含安全快照。 */
import { isAbsolute } from 'node:path'
import {
  hasExactKeys,
  isRecord,
  isStoreStatusJob,
  type StoreStatusSnapshot,
} from '@release-harbor/contracts'
import {
  credentialStore,
  profileRevision,
  queryStoreStatus,
} from '@release-harbor/provider-app-ship'

async function main(): Promise<void> {
  // 1. 有界私有输入只来自宿主，拒绝不完整协议和非绝对凭据目录。
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
    !isStoreStatusJob(input.job) ||
    !process.send
  )
    throw Error()
  // 2. 凭据目录版本前后复核，更新期间的结果不能当稳定账号事实。
  let result: StoreStatusSnapshot = {
    bindingId: input.job.binding.id,
    channel: input.job.binding.channel,
    checkedAt: new Date().toISOString(),
    code: 'authentication',
    versions: [],
  }
  try {
    const before = await profileRevision(input.vaultPath)
    result = await queryStoreStatus(input.job, credentialStore(input.vaultPath))
    if ((await profileRevision(input.vaultPath)) !== before)
      result = { ...result, code: 'invalid_response', versions: [] }
  } catch {
    // 查询后的目录版本也可能读取失败，此时必须丢弃已得到的成功结果。
    result = { ...result, code: 'authentication', versions: [] }
  }
  // 3. 只返回固定状态投影，原始网络正文与秘密留在可信进程。
  process.send({ schemaVersion: 1, nonce: input.nonce, result })
}
void main()
  .then(() => setTimeout(() => process.exit(0), 20))
  .catch(() => process.exit(1))
process.once('disconnect', () => process.exit(1))
