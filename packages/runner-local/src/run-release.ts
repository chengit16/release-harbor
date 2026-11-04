/** @description 独立执行复核：固定计划、独立副本、身份与账号版本，远端写入前必须向父进程申请许可。 */
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { planFingerprintsMatch } from '@release-harbor/domain'
import {
  checkMerchant,
  credentialStore,
  profileRevision,
  saveHuaweiDraft,
} from '@release-harbor/provider-app-ship'
import type { AttemptResult } from '@release-harbor/contracts'
import { inspectBoundArtifact } from './inspect.ts'
import type { InspectionTask } from './protocol.ts'
import type { ReleaseTask } from './release-protocol.ts'

/** 已收到远端许可后的所有异常均保守返回待核对；临时产物仅清理本次创建目录。 */
export async function runRelease(
  task: ReleaseTask,
  permit: () => Promise<void>,
): Promise<AttemptResult> {
  let temporary: string | undefined
  let remote = false
  try {
    const plan = task.plan
    const s = plan.snapshot
    // 1. 不依赖控制面声明，重新计算全部指纹并限定动作、授权与有效期限。
    if (
      !planFingerprintsMatch(plan) ||
      plan.status !== 'confirmed' ||
      !plan.authorization ||
      plan.authorization.scope !== 'local_once' ||
      Date.now() >= Date.parse(plan.authorization.expiresAt) ||
      s.action !== 'huawei_save_draft' ||
      !s.artifact.identity ||
      !s.artifact.sha256 ||
      (await profileRevision(task.vaultPath)) !== s.preflight.profileRevision
    )
      return 'verification_failed'
    const inspection: InspectionTask = {
      schemaVersion: 1,
      action: 'inspect',
      nonce: task.nonce,
      artifactId: s.artifact.id,
      storageRoot: task.storageRoot,
      format: s.artifact.format,
      sizeBytes: s.artifact.sizeBytes,
      sha256: s.artifact.sha256,
      target: {
        workspaceId: s.application.workspaceId,
        projectId: s.application.projectId,
        applicationId: s.application.id,
        platform: s.application.platform,
        identifier: s.application.identifier,
      },
    }
    const original = await inspectBoundArtifact(inspection)
    if (original.failureCode || !original.identity) return 'verification_failed'
    // 2. 上传使用受控副本，避免原文件在检查后被替换；副本仍需独立身份与摘要核验。
    temporary = await mkdtemp(join(tmpdir(), 'release-harbor-execution-'))
    await mkdir(join(temporary, s.artifact.id), { mode: 0o700 })
    const file = join(temporary, s.artifact.id, 'payload.' + s.artifact.format)
    await copyFile(join(task.storageRoot, s.artifact.id, 'payload.' + s.artifact.format), file)
    const copied = await inspectBoundArtifact({ ...inspection, storageRoot: temporary })
    if (
      copied.failureCode ||
      !copied.identity ||
      copied.identity.versionName !== s.artifact.identity.versionName ||
      copied.identity.buildNumber !== s.artifact.identity.buildNumber
    )
      return 'verification_failed'
    // 3. 只读商店核对先于写入许可；不会将预检通过当上传权限。
    const merchant = await checkMerchant(
      {
        channel: s.binding.channel,
        reference: s.binding.credentialReference,
        identifier: s.application.identifier,
        appId: s.binding.appId,
      },
      credentialStore(task.vaultPath),
    )
    if (merchant.code !== 'verified') return 'verification_failed'
    return await saveHuaweiDraft(plan, file, task.vaultPath, async () => {
      await permit()
      remote = true
    })
  } catch {
    return remote ? 'needs_reconciliation' : 'verification_failed'
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true }).catch(() => undefined)
  }
}
