/** @description 凭据解析前复核产物、平台与目录版本，商店访问只发生在可信 worker 内。 */
import {
  checkMerchant,
  credentialStore,
  profileCatalog,
  profileRevision,
} from '@release-harbor/provider-app-ship'
import type { PreflightOutcome, PreflightTask } from './preflight-protocol.ts'
import { inspectBoundArtifact } from './inspect.ts'

/** 旧快照只会被拒绝，不能替换为新档案继续核验。 */
export async function checkPreflight(
  task: Extract<PreflightTask, { action: 'preflight' }>,
): Promise<PreflightOutcome> {
  const outcome: PreflightOutcome = {
    code: 'credentials_unavailable',
    artifact: 'unverified',
    authentication: 'unverified',
    target: 'unverified',
  }
  // 1. 只查看目录元数据，引用、渠道和版本缺一不可，尚不解密。
  const catalog = await profileCatalog(task.vaultPath)
  const profile = catalog.profiles.find(
    (p) => p.reference === task.reference && p.channel === task.channel && p.configured,
  )
  if (!profile) return outcome
  if (profile.revision !== task.profileRevision) return { ...outcome, code: 'profile_changed' }
  // 2. 真正字节不匹配时提前退出，避免读取不必要的凭据。
  const inspection = await inspectBoundArtifact(task.inspection).catch(() => null)
  if (!inspection?.identity || inspection.failureCode)
    return {
      ...outcome,
      code:
        inspection?.failureCode === 'inspection_unavailable'
          ? 'runner_unavailable'
          : 'artifact_invalid',
    }
  outcome.artifact = 'passed'
  if ((await profileRevision(task.vaultPath)) !== task.profileRevision)
    return { ...outcome, code: 'profile_changed' }
  // 3. 仅解析选中档案并调用只读白名单，目录变化时丢弃当次成功。
  const merchant = await checkMerchant(
    {
      channel: task.channel,
      reference: task.reference,
      identifier: task.inspection.target.identifier,
      appId: task.appId,
    },
    credentialStore(task.vaultPath),
  )
  if ((await profileRevision(task.vaultPath)) !== task.profileRevision)
    return { ...outcome, code: 'profile_changed' }
  // 4. 网络等待期间文件也可能变化，成功前再次核对真实字节，不能只沿用前置检查。
  if (merchant.code === 'verified') {
    const finalInspection = await inspectBoundArtifact(task.inspection).catch(() => null)
    if (!finalInspection?.identity || finalInspection.failureCode)
      return { ...outcome, artifact: 'unverified', code: 'artifact_invalid' }
    if ((await profileRevision(task.vaultPath)) !== task.profileRevision)
      return { ...outcome, code: 'profile_changed' }
  }
  return { ...outcome, ...merchant }
}
