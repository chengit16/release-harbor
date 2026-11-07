/** @description 已绑定商店的只读版本状态查询；只使用官方固定路由并投影有限状态，不读取发布计划。 */
import type { CredentialProfileStore } from '@huoye/app-ship'
import {
  isRecord,
  isStoreStatusSnapshot,
  isStoreStatusJob,
  type StoreStatusJob,
  type StoreStatusSnapshot,
  type StoreVersionStatus,
  type StoreMaterialReport,
} from '@release-harbor/contracts'
import { StoreRequestError, storeRequest, storeSession, storeScalar } from './store-client.ts'
import { VivoRequestError, vivoRequest } from './vivo-client.ts'
import { readOtherStoreVersions } from './store-status-other.ts'
import { OppoRequestError } from './oppo-client.ts'
import { AppleReviewError } from './apple-review-client.ts'
import { loadXiaomiPublicVersion } from './xiaomi-listing.ts'
import { appleReviewClient } from './apple-review-client.ts'
import {
  materialReport,
  materialText,
  materialUrl,
  materialImages,
  materialAggregate,
  rejectionSummary,
} from './store-material-projection.ts'
import { inspectAppleStoreMaterials } from './apple-store-materials.ts'

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
  if (job.materialVersionId) {
    // 3. 魅族按用户选定的官方版本 ID 查详情，不扫描所有历史版本，也不猜最新项。
    const selected = output.find((item) => item.versionId === job.materialVersionId)
    if (!selected) throw Error('invalid_response')
    const detail = (
      await storeRequest(
        session,
        'detail',
        { verId: job.materialVersionId },
        undefined,
        undefined,
        transport,
      )
    ).value
    if (
      !isRecord(detail) ||
      storeScalar(detail.id) !== job.binding.appId ||
      detail.packageName !== job.identifier ||
      storeScalar(detail.verId) !== job.materialVersionId ||
      detail.versionName !== selected.versionName
    )
      throw Error('invalid_response')
    selected.materials = materialReport(
      {
        description: materialText(detail.appDescription),
        screenshots: materialImages(detail.screenShots),
      },
      {
        name: materialText(detail.name),
        icon: materialText(detail.icon),
        privacy_policy: materialUrl(detail.privacyPolicyUrl),
      },
    )
    return [selected]
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
    if (result) {
      const rejection = rejectionSummary(result.state, current.auditMessage)
      if (rejection) result.rejection = rejection
      output.push(result)
    }
  }
  const release = detail.releaseInfo
  if (isRecord(release) && release.versionName != null && release.versionCode != null) {
    const published = version(null, release.versionName, release.versionCode, 'published', null)
    if (published) {
      const languages =
        Array.isArray(detail.languageInfo) && detail.languageInfo.every(isRecord)
          ? detail.languageInfo
          : []
      const files =
        Array.isArray(detail.fileInfo) && detail.fileInfo.every(isRecord)
          ? detail.fileInfo
          : undefined
      published.materials = materialReport(
        {
          description: materialAggregate(languages.map((item) => materialText(item.intro))),
          screenshots: files
            ? materialImages(
                files
                  .filter((item) => [2, 3].includes(Number(item.fileType)))
                  .map((item) => item.fileUrl),
              )
            : 'unknown',
        },
        {
          name: materialAggregate(languages.map((item) => materialText(item.appName))),
          privacy_policy: materialUrl(detail.basicInfo.privacyPolicyUrl),
          icon: files
            ? materialImages(
                files.filter((item) => Number(item.fileType) === 1).map((item) => item.fileUrl),
              )
            : 'unknown',
        },
      )
      const same = output.find(
        (item) =>
          item.versionName === published.versionName && item.buildNumber === published.buildNumber,
      )
      if (same) {
        same.state = 'published'
        same.materials = published.materials
        delete same.rejection
      } else output.push(published)
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
  if (
    app.packageName !== job.identifier ||
    storeScalar(app.appType) !== '1' ||
    !/^\d{1,3}$/.test(storeScalar(app.status))
  )
    throw Error('invalid_response')
  const status = Number(storeScalar(app.status)),
    // 官方 status 字典优先；只有审核通过时才结合 saleStatus，旧包在架不能覆盖待审或拒绝。
    state: StoreVersionStatus['state'] =
      status === 1
        ? 'draft'
        : status === 2
          ? 'in_review'
          : status === 4
            ? 'rejected'
            : status === 5
              ? 'withdrawn'
              : status === 3
                ? Number(app.saleStatus) === 1
                  ? 'published'
                  : Number(app.saleStatus) === 2
                    ? 'removed'
                    : 'approved'
                : 'unknown',
    result = version(
      null,
      app.versionName ?? null,
      app.versionCode,
      state,
      Number.isSafeInteger(status) && status >= 0 && status <= 1000 ? status : null,
    )
  if (!result) throw Error('invalid_response')
  result.materials = materialReport(
    { description: materialText(app.detailDesc), screenshots: materialImages(app.screenshot) },
    {
      name: materialText(app.mainTitle),
      icon: materialText(app.icon),
      privacy_policy: materialUrl(app.privateSelfCheck),
    },
  )
  const rejection = rejectionSummary(result.state, app.unPassReason)
  if (rejection) result.rejection = rejection
  return [result]
}

/** 仅保留固定错误分类，拒绝把供应商正文或参数原样带到页面。 */
function failureCode(error: unknown): StoreStatusSnapshot['code'] {
  if (error instanceof Error && error.message === 'authentication') return 'authentication'
  if (error instanceof Error && error.message === 'invalid_response') return 'invalid_response'
  if (error instanceof AppleReviewError) {
    if (error.code === 'credentials') return 'authentication'
    if (['target', 'receipt'].includes(error.code)) return 'invalid_response'
    return error.code === 'rejected' ? 'request_rejected' : 'network'
  }
  if (
    error instanceof StoreRequestError ||
    error instanceof VivoRequestError ||
    error instanceof OppoRequestError
  ) {
    if (
      ['store_authentication', 'vivo_authentication', 'merchant_authentication'].includes(
        error.diagnostic,
      )
    )
      return 'authentication'
    if (
      ['upload_invalid_response', 'store_target_mismatch', 'vivo_target_mismatch'].includes(
        error.diagnostic,
      )
    )
      return 'invalid_response'
    if (
      [
        'store_request_rejected',
        'vivo_request_rejected',
        'oppo_request_rejected',
        'store_target_not_ready',
        'vivo_target_not_ready',
        'store_rate_limited',
        'vivo_rate_limited',
      ].includes(error.diagnostic)
    )
      return 'request_rejected'
  }
  return 'network'
}

/** 商店与身份绑定只在可信 worker 内恢复；平台不支持或返回不明时绝不构造审核结论。 */
export async function queryStoreStatus(
  job: StoreStatusJob,
  store: CredentialProfileStore,
  transport: typeof fetch = fetch,
): Promise<StoreStatusSnapshot> {
  let versions: StoreVersionStatus[] = []
  let materials: StoreMaterialReport | undefined
  try {
    if (!isStoreStatusJob(job)) throw Error('invalid_response')
    if (job.binding.applicationId.length === 0 || job.binding.appId.length === 0)
      throw Error('invalid_response')
    if (job.materialVersionId && job.binding.channel === 'app_store') {
      const inspected = await inspectAppleStoreMaterials(
        await appleReviewClient(store, job.binding.credentialReference, transport),
        job,
      )
      versions = inspected.versions
      materials = inspected.materials
    } else if (job.binding.channel === 'meizu') versions = await queryMeizu(job, store, transport)
    else if (job.binding.channel === 'honor') versions = await queryHonor(job, store, transport)
    else if (job.binding.channel === 'vivo') versions = await queryVivo(job, store, transport)
    else if (job.binding.channel === 'xiaomi') {
      if (job.binding.appId !== job.identifier) throw Error('invalid_response')
      versions = [
        {
          versionId: null,
          versionName: await loadXiaomiPublicVersion(job.identifier, transport),
          buildNumber: null,
          state: 'published',
          rawState: null,
        },
      ]
    } else if (['app_store', 'oppo', 'tencent', 'harmony', 'huawei'].includes(job.binding.channel))
      versions = await readOtherStoreVersions(job, store, transport)
    else
      return {
        bindingId: job.binding.id,
        channel: job.binding.channel,
        checkedAt: new Date().toISOString(),
        code: 'unsupported',
        versions: [],
      }
    if (job.materialVersionId && job.binding.channel === 'meizu') materials = versions[0]?.materials
    const snapshot: StoreStatusSnapshot = {
      ...(job.query ? { query: job.query } : {}),
      ...(job.materialVersionId ? { materialVersionId: job.materialVersionId, materials } : {}),
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
      ...(job.query ? { query: job.query } : {}),
      ...(job.materialVersionId ? { materialVersionId: job.materialVersionId } : {}),
      bindingId: job.binding.id,
      channel: job.binding.channel,
      checkedAt: new Date().toISOString(),
      code: failureCode(error),
      versions: [],
    }
  }
}
