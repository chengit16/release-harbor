/** @description Apple 指定版本只读资料检查；私人材料仅在可信进程判定完整性，不输出原文或地址。 */
import {
  isRecord,
  type StoreMaterialReport,
  type StoreStatusJob,
  type StoreVersionStatus,
} from '@release-harbor/contracts'
import { appleId, AppleReviewError, type AppleReviewClient } from './apple-review-client.ts'
import { readAppleStoreStatus } from './apple-store-status.ts'

type CheckState = StoreMaterialReport['checks']['build']

function attributes(item: Record<string, unknown>, type: string): Record<string, unknown> {
  if (item.type !== type || !isRecord(item.attributes)) throw new AppleReviewError('receipt')
  appleId(item.id)
  return item.attributes
}
function filled(value: unknown): boolean {
  return typeof value === 'string' && !!value.trim()
}
function aggregate(values: CheckState[]): CheckState {
  if (values.includes('missing') || !values.length) return 'missing'
  return values.includes('unknown') ? 'unknown' : 'present'
}

async function screenshots(
  client: AppleReviewClient,
  locales: Record<string, unknown>[],
): Promise<CheckState> {
  // 检查所有已返回语种是否至少有一张完成上传的截图；预算外不以抽样冒充完整。
  if (!locales.length) return 'missing'
  if (locales.length > 3) return 'unknown'
  let remainingSets = 6
  const states: CheckState[] = []
  for (const locale of locales) {
    const sets = await client.list(
      `/v1/appStoreVersionLocalizations/${appleId(locale.id)}/appScreenshotSets`,
    )
    if (sets.length > remainingSets) return 'unknown'
    remainingSets -= sets.length
    let complete = false
    for (const set of sets) {
      if (set.type !== 'appScreenshotSets') throw new AppleReviewError('receipt')
      const images = await client.list(`/v1/appScreenshotSets/${appleId(set.id)}/appScreenshots`, {
        'fields[appScreenshots]': 'assetDeliveryState',
      })
      for (const image of images) {
        const a = attributes(image, 'appScreenshots')
        if (isRecord(a.assetDeliveryState) && a.assetDeliveryState.state === 'COMPLETE')
          complete = true
      }
    }
    states.push(complete ? 'present' : 'missing')
  }
  return aggregate(states)
}

/** 不要求本机计划；先在绑定官方目录中核对版本，再检查该版本关系下有限材料，零写请求。 */
export async function inspectAppleStoreMaterials(
  client: AppleReviewClient,
  job: StoreStatusJob,
): Promise<{ versions: StoreVersionStatus[]; materials: StoreMaterialReport }> {
  // 1. 应用身份和版本归属先核对，拒绝直接读取账号下任意版本 ID。
  const versions = await readAppleStoreStatus(client, job)
  const version = versions.find((item) => item.versionId === job.materialVersionId)
  if (!version || !job.materialVersionId) throw new AppleReviewError('target')
  const locales = await client.list(
    `/v1/appStoreVersions/${appleId(job.materialVersionId)}/appStoreVersionLocalizations`,
    { 'fields[appStoreVersionLocalizations]': 'locale,description,supportUrl' },
  )
  if (locales.length > 40) throw new AppleReviewError('receipt')
  const fields = locales.map((item) => attributes(item, 'appStoreVersionLocalizations'))
  if (
    fields.some((a) => typeof a.locale !== 'string' || !/^[A-Za-z0-9-]{1,40}$/.test(a.locale)) ||
    new Set(fields.map((a) => a.locale)).size !== fields.length ||
    new Set(locales.map((item) => item.id)).size !== locales.length
  )
    throw new AppleReviewError('receipt')
  // 2. 私人联系人与测试资料只投影完整性；没有关系数据时显示缺项，不输出任何字段值。
  const rawDetail = await client.request(
    'GET',
    `/v1/appStoreVersions/${job.materialVersionId}/appStoreReviewDetail`,
    undefined,
    {
      'fields[appStoreReviewDetails]':
        'contactFirstName,contactLastName,contactEmail,contactPhone,demoAccountRequired,demoAccountName,demoAccountPassword',
    },
  )
  if (rawDetail.data !== null && !isRecord(rawDetail.data)) throw new AppleReviewError('receipt')
  const review = rawDetail.data === null ? {} : attributes(rawDetail.data, 'appStoreReviewDetails')
  const checks: StoreMaterialReport['checks'] = {
    build: version.buildNumber ? 'present' : 'missing',
    description: aggregate(fields.map((a) => (filled(a.description) ? 'present' : 'missing'))),
    support_url: aggregate(
      fields.map((a) => {
        if (!filled(a.supportUrl)) return 'missing'
        try {
          return ['http:', 'https:'].includes(new URL(String(a.supportUrl)).protocol)
            ? 'present'
            : 'missing'
        } catch {
          return 'missing'
        }
      }),
    ),
    screenshots: await screenshots(client, locales),
    review_contact: ['contactFirstName', 'contactLastName', 'contactEmail', 'contactPhone'].every(
      (key) => filled(review[key]),
    )
      ? 'present'
      : 'missing',
    demo_access:
      review.demoAccountRequired === false
        ? 'not_required'
        : review.demoAccountRequired === true
          ? filled(review.demoAccountName) && filled(review.demoAccountPassword)
            ? 'present'
            : 'missing'
          : 'unknown',
    privacy: 'unchecked',
    compliance: 'unchecked',
  }
  // Apple 只允许在声明已关联的构建上检查加密声明；它不等同于出口合规结论。
  const buildRelation = await client.request(
    'GET',
    `/v1/appStoreVersions/${job.materialVersionId}/build`,
  )
  if (!isRecord(buildRelation.data) || buildRelation.data.type !== 'builds')
    throw new AppleReviewError('receipt')
  const buildId = appleId(buildRelation.data.id)
  const buildResponse = await client.request('GET', `/v1/builds/${buildId}`, undefined, {
    'fields[builds]': 'usesNonExemptEncryption',
  })
  if (
    !isRecord(buildResponse.data) ||
    buildResponse.data.type !== 'builds' ||
    !isRecord(buildResponse.data.attributes)
  )
    throw new AppleReviewError('receipt')
  const encryption = buildResponse.data.attributes.usesNonExemptEncryption
  let encryptionDeclaration: unknown
  try {
    encryptionDeclaration = (
      await client.request('GET', `/v1/builds/${buildId}/appEncryptionDeclaration`)
    ).data
  } catch {
    encryptionDeclaration = undefined
  }
  const extraChecks: NonNullable<StoreMaterialReport['extraChecks']> = {
    encryption:
      typeof encryption !== 'boolean'
        ? 'unknown'
        : encryption === false
          ? 'not_required'
          : isRecord(encryptionDeclaration) &&
              encryptionDeclaration.type === 'appEncryptionDeclarations' &&
              isRecord(encryptionDeclaration.attributes) &&
              typeof encryptionDeclaration.attributes.usesEncryption === 'boolean' &&
              typeof encryptionDeclaration.attributes.exempt === 'boolean'
            ? 'present'
            : 'unknown',
    age_rating: 'unknown',
    privacy_policy: 'unknown',
  }
  // 3. AppInfo 是应用级资料，未证明它与当前版本对应，故不把网址或评级冒充本版本检查结果。
  const appInfos = await client.list(`/v1/apps/${appleId(job.binding.appId)}/appInfos`, {
    'filter[platform]': 'IOS',
    include: 'ageRatingDeclaration',
  })
  if (!appInfos.every((item) => item.type === 'appInfos' && isRecord(item.attributes)))
    throw new AppleReviewError('receipt')
  if (appInfos.length === 1) {
    const info = appInfos[0]
    if (info && isRecord(info.relationships)) {
      const age = info.relationships.ageRatingDeclaration
      if (isRecord(age) && isRecord(age.data)) {
        const declaration = await client.request(
          'GET',
          `/v1/appInfos/${appleId(info.id)}/ageRatingDeclaration`,
        )
        if (isRecord(declaration.data) && declaration.data.type === 'ageRatingDeclarations')
          extraChecks.age_rating = 'present'
      }
      const localization = await client.list(
        `/v1/appInfos/${appleId(info.id)}/appInfoLocalizations`,
        {
          'fields[appInfoLocalizations]':
            'locale,privacyPolicyUrl,privacyPolicyText,privacyChoicesUrl',
        },
      )
      if (localization.length <= 40 && localization.every((item) => isRecord(item.attributes))) {
        const policies = localization.map((item) => {
          const fields = item.attributes
          if (!isRecord(fields)) return 'missing' as const
          return typeof fields.privacyPolicyUrl === 'string' &&
            /^https?:\/\//.test(fields.privacyPolicyUrl)
            ? ('present' as const)
            : ('missing' as const)
        })
        extraChecks.privacy_policy =
          policies.length && policies.every((state) => state === 'present') ? 'present' : 'missing'
      }
    }
  }
  // 4. 本报告是字段完整性，不复用送审授权，也不能证明联系人可联系或测试账号能登录。
  return { versions: [version], materials: { checks, extraChecks } }
}
