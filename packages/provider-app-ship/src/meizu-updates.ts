/** @description 魅族已有普通应用单包新版本发布；复用现有资料、单次上传和发布，定时策略明确拒绝。 */
import { openAsBlob } from 'node:fs'
import { parsePackageInfo, type CredentialProfileStore } from '@huoye/app-ship'
import {
  isRecord,
  isStoreId,
  sameMeizuUpdateDetails,
  type AttemptResult,
  type ExecutionDiagnostic,
  type ReviewAnchor,
} from '@release-harbor/contracts'
import { type StoreReleaseContext } from './store-release-context.ts'
import { meizuTarget } from './meizu-material.ts'
import { StoreRequestError, storeScalar, storeSession, storeRequest } from './store-client.ts'
import { verifyStoreArtifact, verifyStoreWindow } from './store-execution.ts'

/** 测试只由可信宿主注入网络，页面或任务不得选择模拟平台。 */
export interface StoreExecutionPorts {
  transport?: typeof fetch
  report?: (code: ExecutionDiagnostic) => void
  /** 仅已完成目标核对的新版本可回报，不携带完整详情。 */
  onReviewAnchor?: (anchor: ReviewAnchor) => void
}
/** 许可覆盖一次文件和一次发布，只有新 verId 的在审事实匹配本次目标才报告送审完成。 */
export async function submitMeizuUpdate(
  plan: StoreReleaseContext,
  file: string,
  vaultPath: string,
  beforeRemote: () => Promise<void>,
  store: CredentialProfileStore,
  ports: StoreExecutionPorts = {},
): Promise<AttemptResult> {
  const s = plan.snapshot,
    transport = ports.transport ?? fetch
  let remote = false,
    stage: ExecutionDiagnostic = 'store_submission_validation'
  try {
    // 1. 只接入新版本普通应用，明确阻止缺失／定时策略，不能悄悄改为实时。
    if (
      s.action !== 'meizu_submit_review' ||
      s.binding.channel !== 'meizu' ||
      !s.meizu ||
      !s.artifact.identity ||
      s.releasePolicy?.mode !== 'after_approval'
    )
      throw new StoreRequestError('store_unsupported_release_policy')
    stage = 'profile_changed'
    const material = await store.resolveForLocalExecution({
      credentialProfile: s.binding.credentialReference,
      platform: 'meizu',
      purpose: 'release_execution',
    })
    stage = 'merchant_unavailable'
    const session = await storeSession('meizu', material.fields, transport),
      current = await meizuTarget(session, s.application.identifier, s.binding.appId, transport)
    if (!sameMeizuUpdateDetails(current.summary, s.meizu))
      throw new StoreRequestError('store_source_changed')
    if (s.artifact.identity.versionName === s.meizu.sourceVersionName)
      throw new StoreRequestError('store_version_invalid')
    // 2. 真实副本和账号版本核对后申请一次远端许可；第一笔上传前尚无远端写入。
    stage = 'artifact_invalid'
    await verifyStoreArtifact(plan, file)
    // 魅族官方拒绝包含 32 位库的 APK；先在本机解析，避免取得许可后才发现架构不符。
    const inspected = await parsePackageInfo(file)
    if (!inspected) throw new StoreRequestError('artifact_invalid')
    if (inspected.nativeCode?.some((code) => ['armeabi', 'armeabi-v7a', 'x86'].includes(code)))
      throw new StoreRequestError('store_version_invalid')
    await verifyStoreWindow(plan, vaultPath, true)
    const blob = await openAsBlob(file)
    await beforeRemote()
    remote = true
    stage = 'remote_unknown'
    const uploaded = (await storeRequest(session, 'upload', {}, undefined, blob, transport)).value
    if (
      !isRecord(uploaded) ||
      typeof uploaded.destFileName !== 'string' ||
      !uploaded.destFileName ||
      uploaded.destFileName.length > 8192 ||
      /[\x00-\x1f\x7f]/.test(uploaded.destFileName)
    )
      throw new StoreRequestError('store_upload_mismatch')
    // 3. 文件路径留在本进程，发布只复用白名单资料，不扩散证件、联系方式或完整响应。
    await verifyStoreWindow(plan, vaultPath)
    const accepted = (
      await storeRequest(
        session,
        'submit',
        {},
        { ...current.fields, packageUrl: uploaded.destFileName, verDesc: s.releaseNotes },
        undefined,
        transport,
      )
    ).value
    const verId = isRecord(accepted) ? storeScalar(accepted.verId) : ''
    if (!isStoreId(verId) || verId === s.meizu.sourceVersionId)
      throw new StoreRequestError('store_receipt_missing')
    // 4. 发布接口成功不直接推断审核状态；只读新版本详情，包名、ID、版本和状态均须匹配。
    const result = (
      await storeRequest(session, 'detail', { verId }, undefined, undefined, transport)
    ).value
    if (
      !isRecord(result) ||
      storeScalar(result.id) !== s.binding.appId ||
      result.packageName !== s.application.identifier ||
      storeScalar(result.verId) !== verId ||
      result.versionName !== s.artifact.identity.versionName ||
      (result.status !== 20 && result.status !== 100)
    )
      throw new StoreRequestError('store_receipt_missing')
    ports.onReviewAnchor?.({ channel: 'meizu', versionId: verId })
    return 'meizu_review_submitted'
  } catch (error) {
    stage =
      error instanceof StoreRequestError ? error.diagnostic : remote ? 'remote_unknown' : stage
    ports.report?.(stage)
    return remote ? 'needs_reconciliation' : 'verification_failed'
  }
}
