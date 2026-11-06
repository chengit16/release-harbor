/** @description 独立执行复核：固定计划、独立副本、身份与账号版本，远端写入前必须向父进程申请许可。 */
import { planFingerprintsMatch, planFingerprint } from '@release-harbor/domain'
import {
  checkMerchant,
  type StoreReleaseContext,
  credentialStore,
  profileRevision,
  uploadAppleBuild,
  AppleToolUnavailableError,
  saveHuaweiDraft,
  submitXiaomiUpdate,
  submitOppoUpdate,
  submitVivoUpdate,
  submitMeizuUpdate,
  submitHonorUpdate,
  submitTencentUpdate,
  submitHarmonyUpdate,
} from '@release-harbor/provider-app-ship'
import {
  isReleasePolicyCurrent,
  isRemoteExecutionDiagnostic,
  type AttemptResult,
  type BatchTargetValidation,
  type ExecutionDiagnostic,
} from '@release-harbor/contracts'
import { withVerifiedReleaseArtifact } from './release-artifact.ts'
import type { InspectionTask } from './protocol.ts'
import { isBatchExecution, type ReleaseTask } from './release-protocol.ts'

/** 只供可信宿主装配的商店端口；测试注入内存凭据与受控网络，不由任务或环境变量选择。 */
export interface ReleaseProvider {
  credentialStore: typeof credentialStore
  checkMerchant: typeof checkMerchant
  uploadAppleBuild?: typeof uploadAppleBuild
  saveHuaweiDraft: typeof saveHuaweiDraft
  submitXiaomiUpdate: typeof submitXiaomiUpdate
  submitVivoUpdate: typeof submitVivoUpdate
  submitMeizuUpdate: typeof submitMeizuUpdate
  submitTencentUpdate?: typeof submitTencentUpdate
  submitHarmonyUpdate?: typeof submitHarmonyUpdate
  submitHonorUpdate: typeof submitHonorUpdate
  submitOppoUpdate: typeof submitOppoUpdate
}
const localProvider: ReleaseProvider = {
  credentialStore,
  checkMerchant,
  uploadAppleBuild,
  saveHuaweiDraft,
  submitXiaomiUpdate,
  submitOppoUpdate,
  submitVivoUpdate,
  submitMeizuUpdate,
  submitHonorUpdate,
  submitTencentUpdate,
  submitHarmonyUpdate,
}

/** 已收到远端许可后的所有异常均保守返回待核对；临时产物仅清理本次创建目录。
 * 长函数保留原因：全部渠道共用同一已核验副本和首次许可回调，渠道细节已隔离到适配器。 */
export async function runRelease(
  task: ReleaseTask,
  permit: (proof?: BatchTargetValidation) => Promise<void>,
  report: (code: ExecutionDiagnostic) => void = () => undefined,
  provider: ReleaseProvider = localProvider,
): Promise<AttemptResult> {
  let remote = false
  let stage: ExecutionDiagnostic = 'plan_invalid'
  function failed(code: ExecutionDiagnostic): AttemptResult {
    stage = code
    report(code)
    return 'verification_failed'
  }
  try {
    const validationStartedAt = new Date().toISOString()
    const plan = task.plan
    const s = plan.snapshot
    // 摘要和本项目标在独立进程重算；扩大时间窗口不能扩大用户授权的目标或输入。
    const member = task.batch?.manifest.targets.find((t) => t.id === task.batch?.targetId)
    if (
      task.batch &&
      (!isBatchExecution(task.batch) ||
        planFingerprint(task.batch.manifest) !== task.batch.consent.digest ||
        !member ||
        member.planId !== plan.id ||
        member.digest !== plan.digest ||
        member.input.bindingId !== s.binding.id ||
        member.input.expectedBindingRevision !== s.binding.revision ||
        member.input.artifactId !== s.artifact.id ||
        member.input.expectedArtifactSha256 !== s.artifact.sha256 ||
        member.input.releaseNotes !== s.releaseNotes ||
        planFingerprint(member.input.releasePolicy) !== planFingerprint(s.releasePolicy))
    )
      return failed('plan_invalid')
    // 1. 不依赖控制面声明，重新计算全部指纹并限定动作、授权与有效期限。
    if (
      !planFingerprintsMatch(plan) ||
      (s.action === 'apple_upload_build' && s.releasePolicy?.mode === 'scheduled') ||
      !isReleasePolicyCurrent(s.releasePolicy, Date.now()) ||
      (task.batch
        ? plan.status !== 'frozen' ||
          plan.authorization !== null ||
          s.application.platform !== 'android' ||
          Date.now() < Date.parse(task.batch.consent.issuedAt) ||
          Date.now() >= Date.parse(task.batch.consent.expiresAt)
        : plan.status !== 'confirmed' ||
          !plan.authorization ||
          plan.authorization.scope !== 'local_once' ||
          Date.now() >= Date.parse(plan.authorization.expiresAt)) ||
      ![
        'apple_upload_build',
        'huawei_save_draft',
        'xiaomi_submit_review',
        'oppo_submit_review',
        'vivo_submit_review',
        'meizu_submit_review',
        'honor_submit_review',
        'tencent_submit_review',
        'harmony_submit_review',
      ].includes(s.action) ||
      !s.artifact.identity ||
      !s.artifact.sha256
    )
      return failed('plan_invalid')
    const context: StoreReleaseContext = task.batch
      ? {
          ...plan,
          executionWindow: {
            scope: 'local_batch_once',
            issuedAt: task.batch.consent.issuedAt,
            expiresAt: task.batch.consent.expiresAt,
          },
        }
      : plan
    stage = 'profile_changed'
    if ((await profileRevision(task.vaultPath)) !== s.preflight.profileRevision)
      return failed(stage)
    stage = 'artifact_invalid'
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
    // 2. 原件及独立副本均通过实际检查后，才允许解析凭据。
    const result = await withVerifiedReleaseArtifact(
      inspection,
      s.artifact.identity,
      async (file) => {
        // 3. 只读商店核对先于写入许可；不会将预检通过当上传权限。
        // 小米／OPPO／vivo／魅族／荣耀／应用宝／鸿蒙适配器会在解析材料后做一次完整目标核对；这里不能再查询一次触发平台频率限制。
        if (s.action === 'huawei_save_draft' || s.action === 'apple_upload_build') {
          stage = 'merchant_unavailable'
          const merchant = await provider.checkMerchant(
            {
              channel: s.binding.channel,
              reference: s.binding.credentialReference,
              identifier: s.application.identifier,
              appId: s.binding.appId,
            },
            provider.credentialStore(task.vaultPath),
          )
          if (merchant.code !== 'verified')
            return failed(
              merchant.authentication !== 'passed' &&
                [
                  'rejected',
                  'credentials_unavailable',
                  'invalid_credentials',
                  'unsupported_credential_method',
                ].includes(merchant.code)
                ? 'merchant_authentication'
                : [
                      'application_not_found',
                      'ambiguous_application',
                      'application_mismatch',
                      'application_not_ready',
                    ].includes(merchant.code)
                  ? 'merchant_target'
                  : 'merchant_unavailable',
            )
        }
        stage =
          s.action === 'xiaomi_submit_review' ? 'xiaomi_submission_validation' : 'sdk_preparation'
        const beforeRemote = async (): Promise<void> => {
          stage = 'authorization_changed'
          // 适配器已核对同一来源及实际副本，证明只在首次远端请求前产生。
          await permit(
            task.batch
              ? {
                  batchId: task.batch.batchId,
                  revisionId: task.batch.revisionId,
                  targetId: task.batch.targetId,
                  attemptId: task.attemptId,
                  planDigest: plan.digest,
                  checkedAt: validationStartedAt,
                  profileRevision: s.preflight.profileRevision,
                  artifactSha256: s.artifact.sha256 ?? '',
                  scope: 'artifact_profile_merchant_source',
                }
              : undefined,
          )
          remote = true
          stage = 'remote_unknown'
        }
        if (s.action === 'apple_upload_build') {
          if (!task.runtimeRoot) return failed('sdk_preparation')
          return (provider.uploadAppleBuild ?? uploadAppleBuild)(
            context,
            file,
            task.vaultPath,
            task.runtimeRoot,
            beforeRemote,
            {
              store: provider.credentialStore(task.vaultPath),
              report: (code) => {
                stage = code
                report(code)
              },
            },
          )
        }
        if (s.action === 'tencent_submit_review' || s.action === 'harmony_submit_review') {
          const submit =
            s.action === 'tencent_submit_review'
              ? (provider.submitTencentUpdate ?? submitTencentUpdate)
              : (provider.submitHarmonyUpdate ?? submitHarmonyUpdate)
          return submit(
            context,
            file,
            task.vaultPath,
            beforeRemote,
            provider.credentialStore(task.vaultPath),
            {
              report: (code) => {
                stage = code
                report(code)
              },
            },
          )
        }
        if (s.action === 'meizu_submit_review' || s.action === 'honor_submit_review') {
          const submit =
            s.action === 'meizu_submit_review'
              ? provider.submitMeizuUpdate
              : provider.submitHonorUpdate
          return submit(
            context,
            file,
            task.vaultPath,
            beforeRemote,
            provider.credentialStore(task.vaultPath),
            {
              report: (code) => {
                stage = code
                report(code)
              },
            },
          )
        }
        if (s.action === 'vivo_submit_review')
          return provider.submitVivoUpdate(
            context,
            file,
            task.vaultPath,
            beforeRemote,
            provider.credentialStore(task.vaultPath),
            {
              report: (code) => {
                stage = code
                report(code)
              },
            },
          )
        if (s.action === 'oppo_submit_review')
          return provider.submitOppoUpdate(
            context,
            file,
            task.vaultPath,
            beforeRemote,
            provider.credentialStore(task.vaultPath),
            {
              report: (code) => {
                stage = code
                report(code)
              },
            },
          )
        return s.action === 'xiaomi_submit_review'
          ? provider.submitXiaomiUpdate(
              context,
              file,
              task.vaultPath,
              beforeRemote,
              provider.credentialStore(task.vaultPath),
              undefined,
              (code) => {
                stage = code
                report(code)
              },
            )
          : provider.saveHuaweiDraft(context, file, task.vaultPath, beforeRemote)
      },
    )
    if (
      result !== 'build_uploaded' &&
      result !== 'build_available' &&
      result !== 'build_processing' &&
      result !== 'draft_saved' &&
      result !== 'review_submitted' &&
      result !== 'oppo_version_processed' &&
      result !== 'vivo_update_accepted' &&
      result !== 'meizu_review_submitted' &&
      result !== 'honor_review_submitted' &&
      result !== 'tencent_review_submitted' &&
      result !== 'harmony_review_submitted'
    )
      report(stage)
    return result
  } catch (error) {
    if (!remote && error instanceof AppleToolUnavailableError) stage = 'apple_tool_unavailable'
    report(remote && !isRemoteExecutionDiagnostic(stage) ? 'remote_unknown' : stage)
    return remote ? 'needs_reconciliation' : 'verification_failed'
  }
}
