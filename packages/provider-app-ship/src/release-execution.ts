/** @description 可信 worker 的华为草稿适配；固定目标与动作，关闭自动重试，SDK 原始回执只保留内存。 */
import {
  createReleasePlan,
  executeReleasePlan,
  ReleaseReceiptStore,
  createReleaseReceipt,
  type ReleaseReceiptInput,
  type ReleaseExecutorDependencies,
} from '@huoye/app-ship'
import { isRecord, type AttemptResult } from '@release-harbor/contracts'
import {
  storeWindowCurrent,
  storeConfirmationTime,
  type StoreReleaseContext,
} from './store-release-context.ts'
import { credentialStore, profileRevision } from './credentials.ts'

class MemoryReceipts extends ReleaseReceiptStore {
  override async save(input: ReleaseReceiptInput) {
    // 产品自行保存安全回执，禁止 SDK 将本机路径和供应商消息写入默认目录。
    return createReleaseReceipt(input)
  }
}
/** 只允许确定的华为草稿；许可失败时不上传。可选依赖仅供可信测试注入，HTTP 及 worker 输入不接受此参数。 */
export async function saveHuaweiDraft(
  plan: StoreReleaseContext,
  file: string,
  vaultPath: string,
  beforeRemote: () => Promise<void>,
  dependencies?: ReleaseExecutorDependencies,
): Promise<AttemptResult> {
  if (plan.snapshot.action !== 'huawei_save_draft') return 'verification_failed'
  const s = plan.snapshot
  const identity = s.artifact.identity
  if (!identity || !s.artifact.sha256) return 'verification_failed'
  const sdkPlan = createReleasePlan({
    platform: 'huawei',
    action: 'create_draft',
    packageName: s.application.identifier,
    versionName: identity.versionName,
    buildNumber: identity.buildNumber,
    artifact: { path: file, sha256: s.artifact.sha256, sizeBytes: s.artifact.sizeBytes },
    credentialProfile: s.binding.credentialReference,
    // 华为目标固定在下方配置及产品快照，不使用 SDK 仅针对额外商店定义的目标指纹字段。
  })
  const result = await executeReleasePlan({
    plan: sdkPlan,
    confirmation: {
      planId: sdkPlan.planId,
      platform: 'huawei',
      action: 'create_draft',
      artifactSha256: s.artifact.sha256,
      confirmedAt: storeConfirmationTime(plan),
    },
    config: {
      appId: s.application.identifier,
      retry: { maxRetries: 0 },
      publish: {
        huawei: {
          enable: true,
          appId: s.binding.appId,
          credentialProfile: s.binding.credentialReference,
          releaseType: 'draft',
        },
      },
    },
    metadata: { changelog: s.releaseNotes },
    projectRoot: file,
    dependencies: {
      credentialStore: dependencies?.credentialStore ?? credentialStore(vaultPath),
      uploadManager: dependencies?.uploadManager,
      receiptStore: new MemoryReceipts(),
    },
    beforeRemoteRequest: async () => {
      // SDK 解密与自身检查结束后再次核对期限和目录，不能持旧材料进入远端写入。
      if (
        !storeWindowCurrent(plan) ||
        (await profileRevision(vaultPath)) !== s.preflight.profileRevision
      )
        throw new Error('执行依赖已失效')
      await beforeRemote()
    },
  })
  const target = result.report.results.find((r) => r.platform === 'huawei')
  return target?.success === true &&
    isRecord(target.data) &&
    target.data.action === 'create_draft' &&
    target.data.status === 'draft'
    ? 'draft_saved'
    : 'needs_reconciliation'
}
