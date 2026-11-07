/** @description Apple 商店版本状态读取；仅展开已关联构建，不扫描 TestFlight 历史构建或读取审核私人资料。 */
import { isRecord, type StoreStatusJob, type StoreVersionStatus } from '@release-harbor/contracts'
import { appleId, AppleReviewError, type AppleReviewClient } from './apple-review-client.ts'

function state(value: unknown): StoreVersionStatus['state'] {
  if (['WAITING_FOR_REVIEW', 'IN_REVIEW'].includes(String(value))) return 'in_review'
  if (['REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY'].includes(String(value))) return 'rejected'
  if (['READY_FOR_SALE', 'READY_FOR_DISTRIBUTION'].includes(String(value))) return 'published'
  if (['PENDING_DEVELOPER_RELEASE', 'PENDING_APPLE_RELEASE'].includes(String(value)))
    return 'approved'
  if (['DEVELOPER_REMOVED_FROM_SALE', 'REMOVED_FROM_SALE'].includes(String(value))) return 'removed'
  if (value === 'PREPARE_FOR_SUBMISSION') return 'draft'
  if (value === 'DEVELOPER_REJECTED') return 'withdrawn'
  if (value === 'REPLACED_WITH_NEW_VERSION') return 'superseded'
  if (['PROCESSING_FOR_APP_STORE', 'PROCESSING_FOR_DISTRIBUTION'].includes(String(value)))
    return 'processing'
  return 'unknown'
}

/** 先核对绑定应用，再从应用版本关系读取审核状态；构建目录再多也不影响此查询。 */
export async function readAppleStoreStatus(
  client: AppleReviewClient,
  job: StoreStatusJob,
): Promise<StoreVersionStatus[]> {
  // 1. 固定 App ID 与 Bundle ID 双重核对，拒绝凭据下其他应用的资料。
  const { binding, identifier } = job
  const app = (await client.request('GET', `/v1/apps/${appleId(binding.appId)}`)).data
  if (
    !isRecord(app) ||
    app.type !== 'apps' ||
    app.id !== binding.appId ||
    !isRecord(app.attributes) ||
    app.attributes.bundleId !== identifier
  )
    throw new AppleReviewError('target')
  // 2. 状态属于商店版本；include=build 只展开该版本绑定的构建，避免旧全构建目录超限。
  const body = await client.request(
    'GET',
    `/v1/apps/${binding.appId}/appStoreVersions`,
    undefined,
    {
      'filter[platform]': 'IOS',
      include: 'build',
      limit: '200',
    },
  )
  if (
    !Array.isArray(body.data) ||
    body.data.length > 200 ||
    !body.data.every(isRecord) ||
    (isRecord(body.links) && body.links.next)
  )
    throw new AppleReviewError('receipt')
  if (new Set(body.data.map((item) => appleId(item.id))).size !== body.data.length)
    throw new AppleReviewError('receipt')
  const included = body.included ?? []
  if (!Array.isArray(included) || included.length > 200 || !included.every(isRecord))
    throw new AppleReviewError('receipt')
  // 3. 只用明确的版本—构建关系取构建号；没有绑定构建时保持 null，不按版本名猜测。
  return body.data.map((item) => {
    const a = item.attributes
    if (item.type !== 'appStoreVersions' || !isRecord(a) || a.platform !== 'IOS')
      throw new AppleReviewError('receipt')
    const relations = item.relationships
    if (!isRecord(relations) || !isRecord(relations.build)) throw new AppleReviewError('receipt')
    const linked = relations.build.data
    let buildNumber: string | null = null
    if (linked !== null) {
      if (!isRecord(linked) || linked.type !== 'builds') throw new AppleReviewError('receipt')
      const id = appleId(linked.id),
        matches = included.filter((b) => b.type === 'builds' && b.id === id)
      const build = matches[0]
      if (
        matches.length !== 1 ||
        !build ||
        !isRecord(build.attributes) ||
        typeof build.attributes.version !== 'string'
      )
        throw new AppleReviewError('receipt')
      // 官方可能额外返回 app 关系；存在时必须一致，不能忽略明确的错目标证据。
      if (
        isRecord(build.relationships) &&
        isRecord(build.relationships.app) &&
        isRecord(build.relationships.app.data) &&
        (build.relationships.app.data.type !== 'apps' ||
          build.relationships.app.data.id !== binding.appId)
      )
        throw new AppleReviewError('target')
      buildNumber = build.attributes.version
    }
    if (typeof a.versionString !== 'string' || typeof a.appStoreState !== 'string')
      throw new AppleReviewError('receipt')
    return {
      versionId: appleId(item.id),
      versionName: a.versionString,
      buildNumber,
      state: state(a.appStoreState),
      rawState: null,
    }
  })
}
