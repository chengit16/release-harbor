/** @description 魅族确定版本的只读审核观察；只信任原送审取得的 verId，不按名称或最新版本猜测构建关联。 */
import type { CredentialProfileStore } from '@huoye/app-ship'
import {
  isRecord,
  isReviewAnchor,
  type ChannelBinding,
  type ReviewAnchor,
  type ReleaseObservationResult,
} from '@release-harbor/contracts'
import { storeRequest, storeSession, storeScalar, StoreRequestError } from './store-client.ts'

/** 由可信控制面恢复目标；构建号来自原计划与送审锚点，魅族详情本身不提供构建号。 */
export interface MeizuObservationTarget {
  binding: ChannelBinding
  identifier: string
  versionName: string
  buildNumber: string
  reviewAnchor?: ReviewAnchor
}
/** 固定详情 GET，无上传、送审或重试；私密材料和通用错误正文不传播为审核意见。 */
export async function observeMeizuRelease(
  store: CredentialProfileStore,
  job: MeizuObservationTarget,
  transport: typeof fetch = fetch,
): Promise<ReleaseObservationResult> {
  const unknown = (code: ReleaseObservationResult['code']): ReleaseObservationResult => ({
    state: 'unknown',
    code,
    rawState: null,
  })
  if (
    job.binding.channel !== 'meizu' ||
    !isReviewAnchor(job.reviewAnchor) ||
    job.reviewAnchor.channel !== 'meizu'
  )
    return unknown('invalid_response')
  let failure: ReleaseObservationResult['code'] = 'authentication'
  try {
    // 1. 仅在可信进程解析当前账号，不从浏览器接收版本 ID 或任意端点。
    const material = await store.resolveForLocalExecution({
      credentialProfile: job.binding.credentialReference,
      platform: 'meizu',
      purpose: 'verify',
    })
    const session = await storeSession('meizu', material.fields, transport)
    failure = 'network'
    // 2. 版本锚点直接定位原提交，返回 App ID、包名、verId 与版本名仍须逐项核对。
    const detail = (
      await storeRequest(
        session,
        'detail',
        { verId: job.reviewAnchor.versionId },
        undefined,
        undefined,
        transport,
      )
    ).value
    if (
      !isRecord(detail) ||
      storeScalar(detail.id) !== job.binding.appId ||
      detail.packageName !== job.identifier ||
      storeScalar(detail.verId) !== job.reviewAnchor.versionId
    )
      return unknown('invalid_response')
    if (detail.versionName !== job.versionName) return unknown('version_mismatch')
    // 3. 只投影官方字典，待审与审核中均为审核中；未知整数保留原码而不推测阶段。
    const status = detail.status
    if (typeof status !== 'number' || !Number.isSafeInteger(status) || status < 0 || status > 1000)
      return unknown('invalid_response')
    return {
      state:
        status === 20 || status === 100
          ? 'in_review'
          : status === 30
            ? 'rejected'
            : status === 50
              ? 'published'
              : status === 70
                ? 'removed'
                : 'unknown',
      code: 'observed',
      rawState: status,
    }
  } catch (error) {
    if (error instanceof StoreRequestError) {
      if (error.diagnostic === 'store_authentication') return unknown('authentication')
      if (
        ['upload_invalid_response', 'store_target_mismatch', 'store_version_invalid'].includes(
          error.diagnostic,
        )
      )
        return unknown('invalid_response')
    }
    return unknown(failure)
  }
}
