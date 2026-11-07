/** @description Apple 公开目录与资料检查；审核登录信息只转换为完整性布尔值，不出可信进程。 */
import {
  isRecord,
  isAppleBuild,
  isAppleVersion,
  type AppleReviewCatalog,
  type AppleReviewSnapshot,
  type ChannelBinding,
} from '@release-harbor/contracts'
import { planFingerprint } from '@release-harbor/domain'
import { appleId, AppleReviewError, type AppleReviewClient } from './apple-review-client.ts'

function attrs(v: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(v.attributes)) throw new AppleReviewError('receipt')
  return v.attributes
}
function linked(v: Record<string, unknown>, name: string): string | null {
  const r = v.relationships
  if (!isRecord(r) || !isRecord(r[name]) || !isRecord(r[name].data)) return null
  return appleId(r[name].data.id)
}
function data(v: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(v.data)) throw new AppleReviewError('receipt')
  return v.data
}
function list(v: Record<string, unknown>): Record<string, unknown>[] {
  if (
    !Array.isArray(v.data) ||
    !v.data.every(isRecord) ||
    v.data.length > 200 ||
    (isRecord(v.links) && v.links.next)
  )
    throw new AppleReviewError('receipt')
  return v.data
}
/** 只读取绑定应用的有界目录；缺失平台、版本关联或不完整分页明确拒绝。 */
export async function readAppleReviewCatalog(
  client: AppleReviewClient,
  binding: ChannelBinding,
  identifier: string,
): Promise<AppleReviewCatalog> {
  const app = data(await client.request('GET', `/v1/apps/${appleId(binding.appId)}`))
  if (app.id !== binding.appId || attrs(app).bundleId !== identifier)
    throw new AppleReviewError('target')
  // 关系端点 /apps/{id}/builds 不接受 include；资源集合支持按应用过滤及关联展开。
  // 同时核对每个构建的 app 关系，不能仅信任过滤条件保证归属。
  const raw = await client.request('GET', '/v1/builds', undefined, {
    'filter[app]': binding.appId,
    include: 'preReleaseVersion,app',
    limit: '200',
  })
  const included = raw.included
  if (!Array.isArray(included) || !included.every(isRecord) || included.length > 400)
    throw new AppleReviewError('receipt')
  const builds = list(raw).flatMap((b) => {
    if (b.type !== 'builds' || linked(b, 'app') !== binding.appId)
      throw new AppleReviewError('target')
    const a = attrs(b),
      version = included.find(
        (v) => v.id === linked(b, 'preReleaseVersion') && v.type === 'preReleaseVersions',
      )
    if (!version) throw new AppleReviewError('receipt')
    const va = attrs(version)
    if (va.platform !== 'IOS') return []
    const result = {
      id: b.id,
      version: va.version,
      number: a.version,
      state: a.processingState,
      expired: a.expired,
      uploadedAt:
        typeof a.uploadedDate === 'string' && Number.isFinite(Date.parse(a.uploadedDate))
          ? new Date(a.uploadedDate).toISOString()
          : '',
    }
    if (!isAppleBuild(result)) throw new AppleReviewError('receipt')
    return [result]
  })
  const versions = (
    await client.list(`/v1/apps/${binding.appId}/appStoreVersions`, {
      'filter[platform]': 'IOS',
      include: 'build',
    })
  ).map((v) => {
    const a = attrs(v),
      result = {
        id: v.id,
        version: a.versionString,
        state: a.appStoreState,
        releaseType: a.releaseType,
        buildId: linked(v, 'build'),
      }
    if (a.platform !== 'IOS' || !isAppleVersion(result)) throw new AppleReviewError('receipt')
    return result
  })
  return { appId: binding.appId, identifier, builds, versions, checkedAt: new Date().toISOString() }
}
/** 可信来源含公开本地化和检查结果，不对私人审核资料计算指纹或返回原文。 */
export interface AppleReviewSource {
  snapshot: AppleReviewSnapshot
  locales: { id: string; locale: string }[]
}
/** 同一来源规则用于准备及执行前复核，来源变化要求重新准备。 */
export async function inspectAppleReview(
  client: AppleReviewClient,
  binding: ChannelBinding,
  identifier: string,
  buildId: string,
  versionId: string,
  action: 'submit' | 'release',
  mode: 'after_approval' | 'manual',
  notes: string,
  profileRevision: string,
): Promise<AppleReviewSource> {
  // 1. 构建与目标版本均必须属于当前绑定，数字相同不能代替远端关系核对。
  const catalog = await readAppleReviewCatalog(client, binding, identifier)
  const build = catalog.builds.find((v) => v.id === buildId),
    version = catalog.versions.find((v) => v.id === versionId)
  if (!build || !version || build.version !== version.version) throw new AppleReviewError('target')
  if (build.expired || build.state !== 'VALID') throw new AppleReviewError('build')
  if (action === 'release') {
    if (
      version.state !== 'PENDING_DEVELOPER_RELEASE' ||
      version.releaseType !== 'MANUAL' ||
      version.buildId !== build.id ||
      mode !== 'manual'
    )
      throw new AppleReviewError('version')
    return {
      snapshot: {
        binding,
        identifier,
        action,
        build,
        version,
        mode,
        notes: '',
        locales: [],
        profileRevision,
        sourceDigest: planFingerprint({ build, version }),
        checkedAt: catalog.checkedAt,
      },
      locales: [],
    }
  }
  if (
    ![
      'PREPARE_FOR_SUBMISSION',
      'DEVELOPER_REJECTED',
      'REJECTED',
      'METADATA_REJECTED',
      'INVALID_BINARY',
    ].includes(version.state)
  )
    throw new AppleReviewError('version')
  // 2. 不能复用其他人在后台准备的审核集合，避免一次确认连带送审其他内容。
  const reviews = await client.list(`/v1/apps/${binding.appId}/reviewSubmissions`, {
    'filter[platform]': 'IOS',
  })
  if (reviews.some((v) => attrs(v).state !== 'COMPLETE'))
    throw new AppleReviewError('active_review')
  const locals = await client.list(
    `/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`,
  )
  if (!locals.length || locals.length > 40) throw new AppleReviewError('localization')
  const publicLocales = []
  for (const l of locals) {
    const a = attrs(l)
    if (
      typeof a.locale !== 'string' ||
      !a.locale ||
      typeof a.description !== 'string' ||
      !a.description.trim() ||
      typeof a.supportUrl !== 'string' ||
      !/^https?:\/\//.test(a.supportUrl)
    )
      throw new AppleReviewError('localization')
    const sets = await client.list(
      `/v1/appStoreVersionLocalizations/${appleId(l.id)}/appScreenshotSets`,
    )
    if (!sets.length || sets.length > 30) throw new AppleReviewError('localization')
    let screenshots = 0
    const screenshotSources: { id: string; checksum: string | null }[] = []
    for (const s of sets) {
      const images = await client.list(`/v1/appScreenshotSets/${appleId(s.id)}/appScreenshots`)
      screenshots += images.filter((img) => {
        const attributes = attrs(img),
          state = attributes.assetDeliveryState
        if (!isRecord(state) || state.state !== 'COMPLETE') return false
        const checksum = attributes.sourceFileChecksum
        screenshotSources.push({
          id: appleId(img.id),
          checksum:
            typeof checksum === 'string' && /^[a-fA-F0-9]{32,64}$/.test(checksum) ? checksum : null,
        })
        return true
      }).length
    }
    if (!screenshots) throw new AppleReviewError('localization')
    publicLocales.push({
      id: appleId(l.id),
      locale: a.locale,
      description: a.description,
      supportUrl: a.supportUrl,
      whatsNew: a.whatsNew ?? null,
      screenshots,
      screenshotSources: screenshotSources.sort((a, b) => a.id.localeCompare(b.id)),
    })
  }
  const detail = data(
      await client.request('GET', `/v1/appStoreVersions/${version.id}/appStoreReviewDetail`),
    ),
    review = attrs(detail)
  if (
    !['contactFirstName', 'contactLastName', 'contactEmail', 'contactPhone'].every(
      (k) => typeof review[k] === 'string' && review[k].trim(),
    ) ||
    typeof review.demoAccountRequired !== 'boolean' ||
    (review.demoAccountRequired && (!review.demoAccountName || !review.demoAccountPassword))
  )
    throw new AppleReviewError('review_contact')
  // 3. 未明确的加密声明不代填；隐私、评级、合同和其他合规仍以 Apple 送审校验为准。
  const rawBuild = list(
    await client.request('GET', '/v1/builds', undefined, {
      'filter[app]': binding.appId,
      'filter[version]': build.number,
      include: 'preReleaseVersion,app',
      limit: '200',
    }),
  ).find((v) => v.id === build.id)
  if (
    !rawBuild ||
    linked(rawBuild, 'app') !== binding.appId ||
    typeof attrs(rawBuild).usesNonExemptEncryption !== 'boolean'
  )
    throw new AppleReviewError('compliance')
  const sourceDigest = planFingerprint({
    build,
    version,
    locales: publicLocales.sort((a, b) => a.id.localeCompare(b.id)),
    reviewComplete: true,
    encryption: attrs(rawBuild).usesNonExemptEncryption,
  })
  return {
    snapshot: {
      binding,
      identifier,
      action,
      build,
      version,
      mode,
      notes,
      locales: publicLocales.map((l) => l.locale),
      profileRevision,
      sourceDigest,
      checkedAt: new Date().toISOString(),
    },
    locales: publicLocales.map(({ id, locale }) => ({ id, locale })),
  }
}
