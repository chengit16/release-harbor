/** @description inspect-only 执行逻辑，先复核受控路径与摘要，再调用仅供可信 Node 使用的 SDK 适配。 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { isArtifactIdentity } from '@release-harbor/contracts'
import {
  ArtifactInspectionUnavailableError,
  inspectLocalArtifact,
} from '@release-harbor/provider-app-ship'
import type { InspectionOutcome, InspectionTask } from './protocol.ts'

/** 独立进程再次根据实际字节验证父进程的交接事实，不信任浏览器摘要。 */
export async function inspectBoundArtifact(task: InspectionTask): Promise<InspectionOutcome> {
  // 1. 路径只能由存储根、UUID 和固定扩展构成，拒绝符号链接和其他文件类型。
  const root = resolve(task.storageRoot)
  const directory = join(root, task.artifactId)
  const file = join(directory, `payload.${task.format}`)
  for (const path of [root, directory, file]) {
    const stat = await lstat(path)
    if (stat.isSymbolicLink() || (await realpath(path)) !== path)
      return { identity: null, failureCode: 'digest_mismatch' }
  }
  const stat = await lstat(file)
  if (!stat.isFile() || stat.size !== task.sizeBytes)
    return { identity: null, failureCode: 'digest_mismatch' }
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  if (hash.digest('hex') !== task.sha256) return { identity: null, failureCode: 'digest_mismatch' }
  // 2. 只通过适配层取得安全身份；原始 SDK 日志由父进程隔离，不作为公开错误。
  let identity
  try {
    identity = await inspectLocalArtifact(file)
  } catch (error) {
    return {
      identity: null,
      failureCode:
        error instanceof ArtifactInspectionUnavailableError
          ? 'inspection_unavailable'
          : 'inspection_failed',
    }
  }
  if (!isArtifactIdentity(identity)) return { identity: null, failureCode: 'inspection_failed' }
  // 3. SDK 再次取得的摘要和身份必须仍匹配交接任务，才允许标记可用。
  if (identity.sha256 !== task.sha256 || identity.sizeBytes !== task.sizeBytes)
    return { identity: null, failureCode: 'digest_mismatch' }
  if (
    identity.packageName !== task.target.identifier ||
    identity.format !==
      (task.target.platform === 'android'
        ? 'apk'
        : task.target.platform === 'harmony'
          ? 'app'
          : 'ipa')
  )
    return { identity, failureCode: 'identity_mismatch' }
  return { identity, failureCode: null }
}
