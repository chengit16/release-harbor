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
  // 3. 本报告是字段完整性，不复用送审授权，也不能证明联系人可联系或测试账号能登录。
  return { versions: [version], materials: { checks } }
}
