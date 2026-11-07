/** @description 荣耀已有普通应用更新：一次上传、绑定、默认语种说明及送审；真实受理不等于审核或上线。 */
import { openAsBlob } from 'node:fs'
import type { CredentialProfileStore } from '@huoye/app-ship'
import {
  isRecord,
  isStoreId,
  isStoreReceiptId,
  sameHonorUpdateDetails,
  type AttemptResult,
  type ExecutionDiagnostic,
} from '@release-harbor/contracts'
import { type StoreReleaseContext } from './store-release-context.ts'
import { honorTarget } from './honor-material.ts'
import { StoreRequestError, storeScalar, storeSession, storeRequest } from './store-client.ts'
import { verifyStoreArtifact, verifyStoreWindow } from './store-execution.ts'
import type { StoreExecutionPorts } from './meizu-updates.ts'

/** 返回上传入口必须是官方同一目标，不能把 Bearer 或安装包发给任意配置 URL。 */
export function isHonorUploadUrl(value: unknown, appId: string, objectId: string): boolean {
  if (typeof value !== 'string' || value.length > 8192) return false
  try {
    const u = new URL(value)
    return (
      u.origin === 'https://appmarket-openapi-drcn.cloud.honor.com' &&
      !u.username &&
      !u.password &&
      !u.hash &&
      u.pathname === '/openapi/v1/publish/file-upload' &&
      u.searchParams.getAll('appId').length === 1 &&
      u.searchParams.get('appId') === appId &&
      u.searchParams.getAll('objectId').length === 1 &&
      u.searchParams.get('objectId') === objectId
    )
  } catch {
    return false
  }
}
/**
 * 单次确认覆盖完整明确链路；许可后的失败保留待核对，绝不重试送审。
 * 长函数保留原因：上传、绑定、语言和送审共享同一次许可与未知结果状态，按阶段保留协议顺序。
 */
export async function submitHonorUpdate(
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
    // 1. 来源、构建号和说明都在冻结范围内，不能拿草稿动作越过送审授权。
    if (
      s.action !== 'honor_submit_review' ||
      s.binding.channel !== 'honor' ||
      !s.honor ||
      !s.artifact.identity ||
      !s.releasePolicy ||
      s.releaseNotes.length > 500 ||
      !/^\d{1,18}$/.test(s.artifact.identity.buildNumber)
    )
      return 'verification_failed'
    stage = 'profile_changed'
    const material = await store.resolveForLocalExecution({
      credentialProfile: s.binding.credentialReference,
      platform: 'honor',
      purpose: 'release_execution',
    })
    stage = 'merchant_unavailable'
    const session = await storeSession('honor', material.fields, transport),
      current = await honorTarget(session, s.application.identifier, s.binding.appId, transport)
    if (!sameHonorUpdateDetails(current.summary, s.honor))
      throw new StoreRequestError('store_source_changed')
    if (BigInt(s.artifact.identity.buildNumber) <= BigInt(s.honor.sourceVersionCode))
      throw new StoreRequestError('store_version_invalid')
    // 2. 获取文件对象也可能创建平台状态，因此在准备上传入口之前持久化远端许可。
    stage = 'artifact_invalid'
    await verifyStoreArtifact(plan, file)
    await verifyStoreWindow(plan, vaultPath, true)
    const blob = await openAsBlob(file),
      query = { appId: s.binding.appId }
    await beforeRemote()
    remote = true
    stage = 'remote_unknown'
    const prepared = (
      await storeRequest(
        session,
        'prepare',
        query,
        [
          {
            fileName: 'payload.apk',
            fileType: 100,
            fileSize: s.artifact.sizeBytes,
            fileSha256: s.artifact.sha256,
          },
        ],
        undefined,
        transport,
      )
    ).data
    if (!Array.isArray(prepared) || prepared.length !== 1 || !isRecord(prepared[0]))
      throw new StoreRequestError('store_upload_mismatch')
    const item = prepared[0],
      objectId = storeScalar(item.objectId)
    if (
      !isStoreId(objectId) ||
      !Number.isSafeInteger(Number(objectId)) ||
      item.fileName !== 'payload.apk' ||
      typeof item.expireTime !== 'number' ||
      !Number.isSafeInteger(item.expireTime) ||
      item.expireTime * 1000 <= Date.now() ||
      !isHonorUploadUrl(item.uploadUrl, s.binding.appId, objectId)
    )
      throw new StoreRequestError('store_upload_mismatch')
    // 3. 逐笔核对时间和账号，不因上传成功直接送审；绑定后验证实际文件 SHA 与当前构建。
    await verifyStoreWindow(plan, vaultPath)
    await storeRequest(session, 'upload', { ...query, objectId }, undefined, blob, transport)
    await verifyStoreWindow(plan, vaultPath)
    await storeRequest(
      session,
      'bind',
      query,
      { bindingFileList: [{ objectId: Number(objectId) }] },
      undefined,
      transport,
    )
    const detail = (await storeRequest(session, 'detail', query, undefined, undefined, transport))
      .data
    const latest = (await storeRequest(session, 'current', query, undefined, undefined, transport))
      .data
    if (
      !isRecord(detail) ||
      !isRecord(detail.basicInfo) ||
      detail.basicInfo.packageName !== s.application.identifier ||
      storeScalar(detail.basicInfo.appId) !== s.binding.appId ||
      !Array.isArray(detail.fileInfo) ||
      detail.fileInfo.filter((x) => isRecord(x) && x.fileType === 100).length !== 1 ||
      !detail.fileInfo.some(
        (x) => isRecord(x) && x.fileType === 100 && x.fileSha256 === s.artifact.sha256,
      ) ||
      !isRecord(latest) ||
      latest.auditResult !== 4 ||
      (Object.hasOwn(latest, 'appId') && storeScalar(latest.appId) !== s.binding.appId) ||
      storeScalar(latest.versionCode) !== s.artifact.identity.buildNumber ||
      latest.versionName !== s.artifact.identity.versionName
    )
      throw new StoreRequestError('store_upload_mismatch')
    // 4. 只更新默认语言的新特性，保留其余字段且 setAll=0；最后一次送审携带真实上架策略。
    await verifyStoreWindow(plan, vaultPath)
    const language = s.honor.languages.find((l) => l.languageId === s.honor?.defaultLanguage)
    if (!language) throw new StoreRequestError('store_source_invalid')
    await storeRequest(
      session,
      'language',
      query,
      { languageInfoList: [{ ...language, newFeature: s.releaseNotes }], setAll: 0 },
      undefined,
      transport,
    )
    await verifyStoreWindow(plan, vaultPath)
    const body = {
      ...current.privateFields,
      releaseType: s.releasePolicy.mode === 'scheduled' ? 2 : 1,
      ...(s.releasePolicy.mode === 'scheduled'
        ? { releaseTime: s.releasePolicy.notBefore.slice(0, 19) + '+0000' }
        : {}),
    }
    const accepted = await storeRequest(session, 'submit', query, body, undefined, transport)
    if (!isStoreReceiptId(accepted.data)) throw new StoreRequestError('store_receipt_missing')
    if (accepted.data === s.honor.sourceReleaseId)
      throw new StoreRequestError('store_receipt_missing')
    ports.onReviewAnchor?.({ channel: 'honor', versionId: accepted.data })
    return 'honor_review_submitted'
  } catch (error) {
    stage =
      error instanceof StoreRequestError ? error.diagnostic : remote ? 'remote_unknown' : stage
    ports.report?.(stage)
    return remote ? 'needs_reconciliation' : 'verification_failed'
  }
}
