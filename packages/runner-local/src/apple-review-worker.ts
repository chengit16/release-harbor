/** @description Apple 审核固定 worker，私有输入解析与权限握手；秘密和 SDK 仅在可信进程内。 */
import { isAbsolute } from 'node:path'
import { isRecord, hasExactKeys } from '@release-harbor/contracts'
import { credentialStore, profileRevision } from '@release-harbor/provider-app-ship'
import {
  appleReviewClient,
  AppleReviewError,
} from '../../provider-app-ship/src/apple-review-client.ts'
import {
  readAppleReviewCatalog,
  inspectAppleReview,
} from '../../provider-app-ship/src/apple-review-source.ts'
import { executeAppleReview } from '../../provider-app-ship/src/apple-review-execution.ts'
import { isAppleReviewJob, type AppleReviewReply } from './apple-review-protocol.ts'

async function main(): Promise<void> {
  // 1. 有界私有输入校验，不接受额外目录或网页指定的商店路由。
  let raw = ''
  for await (const chunk of process.stdin) {
    raw += String(chunk)
    if (Buffer.byteLength(raw) > 128 * 1024) throw Error()
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
    !isAppleReviewJob(input.job) ||
    !process.send
  )
    throw Error()
  const { job, nonce, vaultPath } = input
  const send = (action: string, value: unknown) =>
    process.send?.({ schemaVersion: 1, nonce, action, value })
  let reply: AppleReviewReply
  try {
    // 2. 仅可信进程读取固定档案，目录变更在解析前后都拒绝。
    const binding = job.kind === 'execute' ? job.snapshot.binding : job.binding
    const revision = await profileRevision(vaultPath)
    if (job.kind === 'execute' && revision !== job.snapshot.profileRevision)
      throw new AppleReviewError('changed')
    const client = await appleReviewClient(credentialStore(vaultPath), binding.credentialReference)
    // 3. 首次写入前等待父进程持久化许可，断连或超时不继续。
    const permit = () =>
      new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => done(false), 60000)
        function done(ok: boolean): void {
          clearTimeout(timeout)
          process.off('message', onMessage)
          process.off('disconnect', disconnected)
          ok ? resolve() : reject(new AppleReviewError('expired'))
        }
        function disconnected(): void {
          done(false)
        }
        function onMessage(v: unknown): void {
          if (
            isRecord(v) &&
            v.schemaVersion === 1 &&
            v.nonce === nonce &&
            v.action === 'grant' &&
            Object.keys(v).length === 3
          )
            done(true)
        }
        process.on('message', onMessage)
        process.once('disconnect', disconnected)
        // 材料目录在长查询期间变化时不能使用旧材料继续写入。
        void profileRevision(vaultPath)
          .then((current) => {
            if (current !== revision) {
              done(false)
              return
            }
            send('permit', null)
          })
          .catch(() => done(false))
      })
    // 4. 返回固定安全投影，完整响应和材料不进入标准输出或日志。
    const value =
      job.kind === 'catalog'
        ? await readAppleReviewCatalog(client, job.binding, job.identifier)
        : job.kind === 'prepare'
          ? (
              await inspectAppleReview(
                client,
                job.binding,
                job.identifier,
                job.buildId,
                job.versionId,
                job.action,
                job.mode,
                job.notes,
                revision,
              )
            ).snapshot
          : await executeAppleReview(client, job.snapshot, permit, () => undefined)
    if ((await profileRevision(vaultPath)) !== revision) throw new AppleReviewError('changed')
    reply = { ok: true, value }
  } catch (error) {
    reply = { ok: false, code: error instanceof AppleReviewError ? error.code : 'network' }
  }
  send('result', reply)
}
void main()
  .then(() => setTimeout(() => process.exit(0), 20))
  .catch(() => process.exit(1))
process.once('disconnect', () => process.exit(1))
