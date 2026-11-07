/** @description 华为 Android 与鸿蒙全网状态和有限资料投影；分别使用 v2/v3，原始审核意见不出可信进程。 */
import { isRecord, type StoreStatusJob, type StoreVersionStatus } from '@release-harbor/contracts'
import {
  materialReport,
  materialText,
  materialUrl,
  materialImages,
  materialAggregate,
  rejectionSummary,
} from './store-material-projection.ts'
import { harmonyRequest, harmonySession } from './tencent-harmony-client.ts'
import { storeScalar } from './store-client.ts'

function state(value: unknown): StoreVersionStatus['state'] {
  const states: Record<string, StoreVersionStatus['state']> = {
    '0': 'published',
    '1': 'rejected',
    '2': 'removed',
    '3': 'pending_release',
    '4': 'in_review',
    '5': 'in_review',
    '6': 'removal_pending',
    '7': 'draft',
    '8': 'rejected',
    '9': 'removal_rejected',
    '10': 'removed',
    '11': 'withdrawn',
    '12': 'pre_review',
    '13': 'pre_rejected',
  }
  return states[storeScalar(value)] ?? 'unknown'
}

function version(app: Record<string, unknown>, onShelf = false): StoreVersionStatus {
  const prefix = onShelf ? 'onShelfVersion' : 'version'
  return {
    versionId: storeScalar(app[prefix + 'Id']) || null,
    versionName: storeScalar(app[prefix + 'Number']) || null,
    buildNumber: storeScalar(app[prefix + 'Code']) || null,
    state: onShelf ? 'published' : state(app.releaseState),
    rawState: onShelf
      ? null
      : /^\d{1,3}$/.test(storeScalar(app.releaseState))
        ? Number(app.releaseState)
        : null,
  }
}

/** 核对包类型与唯一 App ID 后读取当前全网流程；在架旧版独立列出，不覆盖当前审核。 */
export async function readHuaweiStoreStatus(
  job: StoreStatusJob,
  fields: Record<string, string>,
  transport: typeof fetch,
): Promise<StoreVersionStatus[]> {
  // 1. Android 与鸿蒙共用 OAuth，但包类型与应用信息端点必须分别限定。
  const harmony = job.binding.channel === 'harmony'
  const session = await harmonySession(fields, transport)
  // Android 不猜测未核实的包类型值；省略可选过滤，仍须唯一 App ID 与绑定一致。
  const ids = await harmonyRequest(
    session,
    'ids',
    { packageName: job.identifier, ...(harmony ? { packageTypes: '7' } : {}) },
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
  // 2. releaseState 字典只在全网发布方式成立；测试、分阶段不能套用这份映射。
  const response = await harmonyRequest(
    session,
    harmony ? 'info' : 'androidInfo',
    { appId: job.binding.appId, releaseType: '1' },
    undefined,
    transport,
  )
  const app = response.appInfo
  if (
    !isRecord(app) ||
    !/^\d{1,3}$/.test(storeScalar(app.releaseState)) ||
    (Object.hasOwn(app, 'releaseType') && storeScalar(app.releaseType) !== '1') ||
    (Object.hasOwn(app, 'packageName') && app.packageName !== job.identifier)
  )
    throw Error('invalid_response')
  const current = version(app)
  // 可读材料仅属于当前详情，不套用到 onShelf 旧版；Android 与鸿蒙各按官方响应结构取字段。
  if (harmony) {
    const languages =
      Array.isArray(response.languages) && response.languages.every(isRecord)
        ? response.languages
        : []
    const deviceMaterials =
      Array.isArray(response.deviceMaterials) && response.deviceMaterials.every(isRecord)
        ? response.deviceMaterials
        : []
    current.materials = materialReport(
      {
        description: materialAggregate(languages.map((item) => materialText(item.appDesc))),
        screenshots: materialAggregate([
          ...languages.map((item) => materialImages(item.introPic)),
          ...deviceMaterials.map((item) => materialImages(item.screenShots)),
        ]),
      },
      {
        name: materialAggregate(languages.map((item) => materialText(item.appName))),
        icon: materialAggregate([
          ...languages.map((item) => materialText(item.icon)),
          ...deviceMaterials.map((item) => materialText(item.appIcon)),
        ]),
        privacy_policy: materialUrl(app.privacyPolicy),
      },
    )
    const rejection = rejectionSummary(
      current.state,
      isRecord(response.auditInfo) ? response.auditInfo.auditOpinion : undefined,
    )
    if (rejection) current.rejection = rejection
  } else {
    const languages =
      Array.isArray(response.languages) && response.languages.every(isRecord)
        ? response.languages
        : []
    current.materials = materialReport(
      {
        description: materialAggregate(languages.map((item) => materialText(item.appDesc))),
        screenshots: materialAggregate(languages.map((item) => materialImages(item.introPic))),
      },
      {
        name: materialAggregate(languages.map((item) => materialText(item.appName))),
        icon: materialAggregate(languages.map((item) => materialText(item.icon))),
        privacy_policy: materialUrl(app.privacyPolicy),
      },
    )
    const rejection = rejectionSummary(
      current.state,
      isRecord(response.auditInfo) ? response.auditInfo.auditOpinion : undefined,
    )
    if (rejection) current.rejection = rejection
  }
  // 3. 草稿可能没有安装包，保留空版本字段；旧在架版本有明确独立字段时才额外展示。
  const output = [current],
    published = version(app, true)
  const sameVersion =
    published.versionId && current.versionId
      ? published.versionId === current.versionId
      : published.versionName === current.versionName &&
        published.buildNumber === current.buildNumber
  if (published.versionName && published.buildNumber && !sameVersion) output.push(published)
  return output
}
