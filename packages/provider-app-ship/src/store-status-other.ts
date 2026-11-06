/** @description Apple、OPPO、应用宝与鸿蒙的独立版本读取；复用固定官方客户端，不取得发布许可或修改资料。 */
import type { CredentialProfileStore } from '@huoye/app-ship'
import { isRecord, type StoreStatusJob, type StoreVersionStatus } from '@release-harbor/contracts'
import { appleReviewClient } from './apple-review-client.ts'
import { readAppleReviewCatalog } from './apple-review-source.ts'
import { oppoRequest, oppoSession } from './oppo-client.ts'
import { harmonyRequest, harmonySession, tencentRequest } from './tencent-harmony-client.ts'
import { storeScalar } from './store-client.ts'

/** 查询结果先核对身份，再投影字段；未核实的审核字典只能保留未知。 */
export async function readOtherStoreVersions(
  job: StoreStatusJob,
  store: CredentialProfileStore,
  transport: typeof fetch,
): Promise<StoreVersionStatus[]> {
  // 1. Apple 版本与构建均来自官方目录，官网提交版本不需要本地执行记录。
  if (job.binding.channel === 'app_store') {
    const catalog = await readAppleReviewCatalog(
      await appleReviewClient(store, job.binding.credentialReference, transport),
      job.binding,
      job.identifier,
    )
    return catalog.versions.map((item) => ({
      versionId: item.id,
      versionName: item.version,
      buildNumber: catalog.builds.find((build) => build.id === item.buildId)?.number ?? null,
      state: ['WAITING_FOR_REVIEW', 'IN_REVIEW'].includes(item.state)
        ? 'in_review'
        : ['REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY'].includes(item.state)
          ? 'rejected'
          : ['READY_FOR_SALE', 'READY_FOR_DISTRIBUTION'].includes(item.state)
            ? 'published'
            : ['PENDING_DEVELOPER_RELEASE', 'PENDING_APPLE_RELEASE'].includes(item.state)
              ? 'approved'
              : ['DEVELOPER_REMOVED_FROM_SALE', 'REMOVED_FROM_SALE'].includes(item.state)
                ? 'removed'
                : 'unknown',
      rawState: null,
    }))
  }
  // 2. 固定渠道凭据仅在可信进程解析；API 和页面不接收原文。
  const channel = job.binding.channel
  if (!['oppo', 'tencent', 'harmony'].includes(channel)) throw Error('invalid_response')
  const material = await store
    .resolveForLocalExecution({
      credentialProfile: job.binding.credentialReference,
      platform: channel,
      purpose: 'verify',
    })
    .catch(() => {
      throw Error('authentication')
    })
  if (channel === 'oppo') {
    const app = await oppoRequest(
      'info',
      await oppoSession(material.fields, transport),
      { pkg_name: job.identifier },
      transport,
    )
    if (app.pkg_name !== job.identifier || storeScalar(app.type) !== '7')
      throw Error('invalid_response')
    const name = storeScalar(app.version_name),
      code = storeScalar(app.version_code)
    if (!name || !code) throw Error('invalid_response')
    // audit_status 的完整字典尚未核实，应用在架也不能证明当前审核版本已发布。
    return [
      {
        versionId: storeScalar(app.version_id) || null,
        versionName: name,
        buildNumber: code,
        state: 'unknown',
        rawState: null,
      },
    ]
  }
  if (channel === 'tencent') {
    const app = await tencentRequest(
      material.fields,
      'query_app_detail',
      { pkg_name: job.identifier, app_id: job.binding.appId },
      transport,
    )
    if (
      app.pkg_name !== job.identifier ||
      app.app_type !== 1 ||
      (Object.hasOwn(app, 'app_id') && storeScalar(app.app_id) !== job.binding.appId)
    )
      throw Error('invalid_response')
    const name = storeScalar(app.VersionName),
      code = storeScalar(app.VersionCode)
    if (!name || !code) throw Error('invalid_response')
    return [
      { versionId: null, versionName: name, buildNumber: code, state: 'unknown', rawState: null },
    ]
  }
  // 3. 鸿蒙先按独立 packageTypes=7 核对身份；读取正式应用资料，不混用华为 Android。
  const session = await harmonySession(material.fields, transport)
  const ids = await harmonyRequest(
    session,
    'ids',
    { packageName: job.identifier, packageTypes: '7' },
    undefined,
    transport,
  )
  if (
    !Array.isArray(ids.appids) ||
    ids.appids.length !== 1 ||
    !isRecord(ids.appids[0]) ||
    storeScalar(ids.appids[0].value) !== job.binding.appId
  )
    throw Error('invalid_response')
  const app = (
    await harmonyRequest(
      session,
      'info',
      { appId: job.binding.appId, releaseType: '1' },
      undefined,
      transport,
    )
  ).appInfo
  if (!isRecord(app)) throw Error('invalid_response')
  const name = storeScalar(app.versionNumber),
    code = storeScalar(app.versionCode)
  if (!name || !code) throw Error('invalid_response')
  // 正式来源版本可读取，但审核阶段仍需独立官方字典；不把 releaseState 当审核码。
  return [
    { versionId: null, versionName: name, buildNumber: code, state: 'unknown', rawState: null },
  ]
}
