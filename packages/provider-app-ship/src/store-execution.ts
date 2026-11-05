/** @description 魅族／荣耀共用的可信前置检查；仅校验产物与限定授权，不执行远端请求或向控制面返回秘密。 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { isReleasePolicyCurrent, type ReleasePlan } from '@release-harbor/contracts'
import { profileRevision } from './credentials.ts'
import { StoreRequestError } from './store-client.ts'

/** 独立副本在进入商店适配前核对真实字节，不能只相信记录中的 SHA。 */
export async function verifyStoreArtifact(plan: ReleasePlan, file: string): Promise<void> {
  const sha = createHash('sha256')
  let size = 0
  for await (const chunk of createReadStream(file)) {
    sha.update(chunk)
    size += chunk.length
  }
  if (
    size !== plan.snapshot.artifact.sizeBytes ||
    sha.digest('hex') !== plan.snapshot.artifact.sha256
  )
    throw new StoreRequestError('artifact_invalid')
}
/** 写入之间复核账号与定时时间；最初许可前还须检查一次性确认是否过期。 */
export async function verifyStoreWindow(
  plan: ReleasePlan,
  vaultPath: string,
  beforePermit = false,
): Promise<void> {
  if (
    !isReleasePolicyCurrent(plan.snapshot.releasePolicy, Date.now()) ||
    (await profileRevision(vaultPath)) !== plan.snapshot.preflight.profileRevision ||
    (beforePermit &&
      (!plan.authorization || Date.now() >= Date.parse(plan.authorization.expiresAt)))
  )
    throw new StoreRequestError(beforePermit ? 'authorization_changed' : 'store_submit_interrupted')
}
