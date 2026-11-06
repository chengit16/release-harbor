/** @description 已绑定商店的只读版本状态查询；只使用官方固定路由并投影有限状态，不读取发布计划。 */
import type { CredentialProfileStore } from '@huoye/app-ship'
import {
  isRecord,
  isStoreStatusSnapshot,
  type StoreStatusJob,
  type StoreStatusSnapshot,
  type StoreVersionStatus,
} from '@release-harbor/contracts'
import { StoreRequestError, storeRequest, storeSession, storeScalar } from './store-client.ts'
import { VivoRequestError, vivoRequest } from './vivo-client.ts'
import { readOtherStoreVersions } from './store-status-other.ts'
import { OppoRequestError } from './oppo-client.ts'
import { AppleReviewError } from './apple-review-client.ts'

function version(
  versionId: unknown,
  versionName: unknown,
  buildNumber: unknown,
  state: StoreVersionStatus['state'],
  rawState: number | null,
): StoreVersionStatus | null {
  const id = versionId == null ? null : storeScalar(versionId),
    name = versionName == null ? null : storeScalar(versionName),
    build = buildNumber == null ? null : storeScalar(buildNumber)
  if (
    (versionName != null && !name) ||
    (buildNumber != null && !build) ||
    (versionId != null && !id)
  )
    return null
  return { versionId: id, versionName: name, buildNumber: build, state, rawState }
}

function meizuState(value: unknown): StoreVersionStatus['state'] {
  if (value === 20 || value === 100) return 'in_review'
  if (value === 30) return 'rejected'
  if (value === 50) return 'published'
  if (value === 70) return 'removed'
  return 'unknown'
}

async function queryMeizu(
  job: StoreStatusJob,
  store: CredentialProfileStore,
  transport: typeof fetch,
): Promise<StoreVersionStatus[]> {
  const material = await store
    .resolveForLocalExecution({
      credentialProfile: job.binding.credentialReference,
      platform: 'meizu',
      purpose: 'verify',
    })
    .catch(() => {
      throw Error('authentication')
    })
  // 1. 商店返回指定应用的版本目录；这里不依赖原发布记录，也不按名称猜测版本 ID。
  const session = await storeSession('meizu', material.fields, transport)
  const versions = (
    await storeRequest(
      session,
      'versions',
      { appId: job.binding.appId },
      undefined,
      undefined,
      transport,
    )
  ).value
  if (!Array.isArray(versions) || versions.length > 200 || !versions.every(isRecord))
    throw Error('invalid_response')
  if (new Set(versions.map((item) => storeScalar(item.verId))).size !== versions.length)
    throw Error('invalid_response')
  const output: StoreVersionStatus[] = []
  for (const listed of versions) {
    const id = storeScalar(listed.verId)
    if (
      !/^\d{1,30}$/.test(id) ||
      storeScalar(listed.id) !== job.binding.appId ||
      listed.pkgName !== job.identifier
    )
      throw Error('invalid_response')
    // 2. 官方目录已包含确定版本 ID 和状态；不逐条再请求，避免历史版本导致请求风暴。
    const result = version(
      id,
      listed.versionName,
      null,
      meizuState(listed.status),
      typeof listed.status === 'number' &&
        Number.isSafeInteger(listed.status) &&
        listed.status >= 0 &&
        listed.status <= 1000
        ? listed.status
        : null,
    )
    if (!result) throw Error('invalid_response')
    output.push(result)
  }
  return output
}

async function queryHonor(
  job: StoreStatusJob,
  store: CredentialProfileStore,
  transport: typeof fetch,
): Promise<StoreVersionStatus[]> {
  const material = await store
    .resolveForLocalExecution({
      credentialProfile: job.binding.credentialReference,
      platform: 'honor',
      purpose: 'verify',
    })
    .catch(() => {
      throw Error('authentication')
    })
  // 1. 先核对包名唯一对应的商店 App ID，避免误查账号下其他应用。
  const session = await storeSession('honor', material.fields, transport)
  const ids = (
    await storeRequest(session, 'ids', { pkgName: job.identifier }, undefined, undefined, transport)
  ).data
  if (!Array.isArray(ids) || !ids.every(isRecord) || ids.length > 10)
    throw Error('invalid_response')
  const matched = ids.filter((item) => item.packageName === job.identifier)
  if (matched.length !== 1 || storeScalar(matched[0]?.appId) !== job.binding.appId)
    throw Error('invalid_response')
  // 2. 当前审核流程与正式版本分别读取，不能把旧包在架当新包审核通过。
  const current = (
      await storeRequest(
        session,
        'current',
        { appId: job.binding.appId },
        undefined,
        undefined,
        transport,
      )
    ).data,
    detail = (
      await storeRequest(
        session,
        'detail',
        { appId: job.binding.appId },
        undefined,
        undefined,
        transport,
      )
    ).data
  if (!isRecord(current) || !isRecord(detail) || !isRecord(detail.basicInfo))
    throw Error('invalid_response')
  if (
    storeScalar(detail.basicInfo.appId) !== job.binding.appId ||
    detail.basicInfo.packageName !== job.identifier ||
    (Object.hasOwn(current, 'appId') && storeScalar(current.appId) !== job.binding.appId)
  )
    throw Error('invalid_response')
  // 3. 仅映射已核实字典；同版本已在架时以明确上架证据优先。
  const output: StoreVersionStatus[] = [],
    audit = current.auditResult
  if (
    typeof audit === 'number' &&
    Number.isSafeInteger(audit) &&
    current.versionName != null &&
    current.versionCode != null
  ) {
    const state =
      audit === 0 ? 'in_review' : audit === 1 ? 'approved' : audit === 2 ? 'rejected' : 'unknown'
    const result = version(
      current.releaseId,
      current.versionName,
      current.versionCode,
      state,
      audit,
    )
    if (result) output.push(result)
  }
  const release = detail.releaseInfo
  if (isRecord(release) && release.versionName != null && release.versionCode != null) {
    const published = version(null, release.versionName, release.versionCode, 'published', null)
    if (published) {
      const same = output.find(
        (item) =>
          item.versionName === published.versionName && item.buildNumber === published.buildNumber,
      )
      if (same) same.state = 'published'
      else output.push(published)
    }
  }
  if (!output.length) throw Error('invalid_response')
  return output
}

async function queryVivo(
  job: StoreStatusJob,
  store: CredentialProfileStore,
  transport: typeof fetch,
): Promise<StoreVersionStatus[]> {
  const material = await store
    .resolveForLocalExecution({
      credentialProfile: job.binding.credentialReference,
      platform: 'vivo',
      purpose: 'verify',
    })
    .catch(() => {
      throw Error('authentication')
    })
  const app = await vivoRequest(
    'app.query.details',
    material.fields,
    { packageName: job.identifier },
    transport,
  )
  if (app.packageName !== job.identifier || storeScalar(app.appType) !== '1')
    throw Error('invalid_response')
  const status = Number(storeScalar(app.status)),
    // 应用仍在架可能只对应旧包；待审核优先，不用 saleStatus 覆盖当前流程。
    state = status === 2 ? 'in_review' : 'unknown',
    result = version(
      null,
      app.versionName ?? null,
      app.versionCode,
      state,
      Number.isSafeInteger(status) && status >= 0 && status <= 1000 ? status : null,
    )
  if (!result) throw Error('invalid_response')
  return [result]
}

/** 商店与身份绑定只在可信 worker 内恢复；平台不支持或返回不明时绝不构造审核结论。 */
export async function queryStoreStatus(
  job: StoreStatusJob,
  store: CredentialProfileStore,
  transport: typeof fetch = fetch,
): Promise<StoreStatusSnapshot> {
  let versions: StoreVersionStatus[] = []
  try {
    if (job.binding.applicationId.length === 0 || job.binding.appId.length === 0)
      throw Error('invalid_response')
    if (job.binding.channel === 'meizu') versions = await queryMeizu(job, store, transport)
    else if (job.binding.channel === 'honor') versions = await queryHonor(job, store, transport)
    else if (job.binding.channel === 'vivo') versions = await queryVivo(job, store, transport)
    else if (['app_store', 'oppo', 'tencent', 'harmony'].includes(job.binding.channel))
      versions = await readOtherStoreVersions(job, store, transport)
    else
      return {
        bindingId: job.binding.id,
        channel: job.binding.channel,
        checkedAt: new Date().toISOString(),
        code: 'unsupported',
        versions: [],
      }
    const snapshot: StoreStatusSnapshot = {
      bindingId: job.binding.id,
      channel: job.binding.channel,
      checkedAt: new Date().toISOString(),
      code: 'observed',
      versions,
    }
    if (!isStoreStatusSnapshot(snapshot)) throw Error('invalid_response')
    return snapshot
  } catch (error) {
    return {
      bindingId: job.binding.id,
      channel: job.binding.channel,
      checkedAt: new Date().toISOString(),
      code:
        error instanceof Error && error.message === 'authentication'
          ? 'authentication'
          : error instanceof Error && error.message === 'invalid_response'
            ? 'invalid_response'
            : (error instanceof StoreRequestError && error.diagnostic === 'store_authentication') ||
                (error instanceof VivoRequestError && error.diagnostic === 'vivo_authentication') ||
                (error instanceof OppoRequestError &&
                  error.diagnostic === 'merchant_authentication') ||
                (error instanceof AppleReviewError && error.code === 'credentials')
              ? 'authentication'
              : (error instanceof AppleReviewError && ['target', 'receipt'].includes(error.code)) ||
                  ((error instanceof StoreRequestError ||
                    error instanceof VivoRequestError ||
                    error instanceof OppoRequestError) &&
                    ['upload_invalid_response', 'store_target_mismatch'].includes(error.diagnostic))
                ? 'invalid_response'
                : 'network',
      versions: [],
    }
  }
}
