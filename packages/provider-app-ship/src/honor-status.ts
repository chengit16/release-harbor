/** @description 荣耀版本级审核观察，固定只读路由；不传输审核附件、意见原文、账号或供应商正文。 */
import type { CredentialProfileStore } from '@huoye/app-ship'
import { isRecord, type ReleaseObservationResult } from '@release-harbor/contracts'
import type { ChannelBinding } from '@release-harbor/contracts'
import { storeRequest, storeSession, storeScalar, StoreRequestError } from './store-client.ts'
/** 可信调用者提供已核对的荣耀目标；不依赖执行器或 Web 类型。 */
export interface HonorObservationTarget {
  binding: ChannelBinding
  identifier: string
  versionName: string
  buildNumber: string
}

/** 精确核对目标及本次版本；公开上架旧版本和其他审核单均不能被用于本次发布。 */
export async function observeHonorRelease(
  store: CredentialProfileStore,
  job: HonorObservationTarget,
  transport: typeof fetch = fetch,
): Promise<ReleaseObservationResult> {
  const unknown = (code: ReleaseObservationResult['code']): ReleaseObservationResult => ({
    state: 'unknown',
    code,
    rawState: null,
  })
  let failure: ReleaseObservationResult['code'] = 'authentication'
  try {
    // 1. 仅在可信进程解析材料，按包名确认 App ID；只请求固定查询路由。
    const material = await store.resolveForLocalExecution({
      credentialProfile: job.binding.credentialReference,
      platform: 'honor',
      purpose: 'verify',
    })
    const session = await storeSession('honor', material.fields, transport)
    failure = 'network'
    const ids = (
      await storeRequest(
        session,
        'ids',
        { pkgName: job.identifier },
        undefined,
        undefined,
        transport,
      )
    ).data
    if (!Array.isArray(ids) || !ids.every(isRecord) || ids.length > 10)
      return unknown('invalid_response')
    const matched = ids.filter((item) => item.packageName === job.identifier)
    if (matched.length !== 1 || storeScalar(matched[0]?.appId) !== job.binding.appId)
      return unknown('invalid_response')
    // 2. 官方 releaseInfo 表示已上架版本，只有名称及构建号均匹配才可投影为本次已上架。
    const detail = (
      await storeRequest(
        session,
        'detail',
        { appId: job.binding.appId },
        undefined,
        undefined,
        transport,
      )
    ).data
    if (
      !isRecord(detail) ||
      !isRecord(detail.basicInfo) ||
      storeScalar(detail.basicInfo.appId) !== job.binding.appId ||
      detail.basicInfo.packageName !== job.identifier ||
      !isRecord(detail.releaseInfo)
    )
      return unknown('invalid_response')
    if (
      detail.releaseInfo.versionName === job.versionName &&
      storeScalar(detail.releaseInfo.versionCode) === job.buildNumber
    )
      return { state: 'published', code: 'observed', rawState: null }
    // 3. 当前审核流程必须同时匹配本次版本名与构建号，不复制旧版本或别的审核单状态。
    const current = (
      await storeRequest(
        session,
        'current',
        { appId: job.binding.appId },
        undefined,
        undefined,
        transport,
      )
    ).data
    if (
      !isRecord(current) ||
      (Object.hasOwn(current, 'appId') && storeScalar(current.appId) !== job.binding.appId) ||
      !/^\d+$/.test(storeScalar(current.releaseId))
    )
      return unknown('invalid_response')
    if (
      current.versionName !== job.versionName ||
      storeScalar(current.versionCode) !== job.buildNumber
    )
      return unknown('version_mismatch')
    const audit = current.auditResult
    if (typeof audit !== 'number' || !Number.isSafeInteger(audit) || audit < 0 || audit > 1000)
      return unknown('invalid_response')
    return {
      state:
        audit === 0 ? 'in_review' : audit === 1 ? 'approved' : audit === 2 ? 'rejected' : 'unknown',
      code: 'observed',
      rawState: audit,
    }
  } catch (error) {
    if (error instanceof StoreRequestError) {
      if (error.diagnostic === 'store_authentication') return unknown('authentication')
      if (
        ['upload_invalid_response', 'store_target_mismatch', 'store_source_invalid'].includes(
          error.diagnostic,
        )
      )
        return unknown('invalid_response')
    }
    return unknown(failure)
  }
}
