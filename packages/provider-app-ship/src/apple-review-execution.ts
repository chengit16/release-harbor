/** @description Apple 一次性审核及手动发布协议；来源复核先于持久化许可，部分写入不自动回滚或重试。 */
import { isRecord, type AppleReviewSnapshot, type AppleReviewCode } from '@release-harbor/contracts'
import { planFingerprint } from '@release-harbor/domain'
import { AppleReviewError, appleId, type AppleReviewClient } from './apple-review-client.ts'
import { inspectAppleReview } from './apple-review-source.ts'

function resource(
  response: Record<string, unknown>,
  type: string,
  id?: string,
): Record<string, unknown> {
  const d = response.data
  if (!isRecord(d) || d.type !== type || !d.id || (id !== undefined && d.id !== id))
    throw new AppleReviewError('receipt')
  appleId(d.id)
  return d
}
/** 不接收网页 URL；每一步只操作快照中的版本，任何异常由宿主按许可事实标为未知。 */
export async function executeAppleReview(
  client: AppleReviewClient,
  s: AppleReviewSnapshot,
  permit: () => Promise<void>,
  report: (code: AppleReviewCode) => void,
): Promise<'submitted' | 'release_requested'> {
  // 1. 复核商店来源，不能仅凭页面“检查通过”进入写入。
  const current = await inspectAppleReview(
    client,
    s.binding,
    s.identifier,
    s.build.id,
    s.version.id,
    s.action,
    s.mode,
    s.notes,
    s.profileRevision,
  )
  if (
    current.snapshot.sourceDigest !== s.sourceDigest ||
    planFingerprint(current.snapshot.binding) !== planFingerprint(s.binding)
  )
    throw new AppleReviewError('changed')
  await permit()
  // 2. 手动上线为独立意图，已批准状态再次确认后只发起一次不可撤销的发布请求。
  if (s.action === 'release') {
    resource(
      await client.request('POST', '/v1/appStoreVersionReleaseRequests', {
        data: {
          type: 'appStoreVersionReleaseRequests',
          relationships: {
            appStoreVersion: { data: { type: 'appStoreVersions', id: s.version.id } },
          },
        },
      }),
      'appStoreVersionReleaseRequests',
    )
    return 'release_requested'
  }
  // 3. 设置本次策略及构建，不隐式保留旧定时；逐个现有语种更新说明，不创建或删除语种。
  const updated = resource(
    await client.request('PATCH', `/v1/appStoreVersions/${s.version.id}`, {
      data: {
        type: 'appStoreVersions',
        id: s.version.id,
        attributes: {
          releaseType: s.mode === 'manual' ? 'MANUAL' : 'AFTER_APPROVAL',
          earliestReleaseDate: null,
        },
        relationships: { build: { data: { type: 'builds', id: s.build.id } } },
      },
    }),
    'appStoreVersions',
    s.version.id,
  )
  if (
    !isRecord(updated.attributes) ||
    updated.attributes.releaseType !== (s.mode === 'manual' ? 'MANUAL' : 'AFTER_APPROVAL')
  )
    throw new AppleReviewError('receipt')
  const attached = resource(
    await client.request('GET', `/v1/appStoreVersions/${s.version.id}/build`),
    'builds',
    s.build.id,
  )
  if (!isRecord(attached.attributes) || attached.attributes.version !== s.build.number)
    throw new AppleReviewError('receipt')
  for (const locale of current.locales) {
    const updatedLocale = resource(
      await client.request('PATCH', `/v1/appStoreVersionLocalizations/${locale.id}`, {
        data: {
          type: 'appStoreVersionLocalizations',
          id: locale.id,
          attributes: { whatsNew: s.notes },
        },
      }),
      'appStoreVersionLocalizations',
      locale.id,
    )
    if (!isRecord(updatedLocale.attributes) || updatedLocale.attributes.whatsNew !== s.notes)
      throw new AppleReviewError('receipt')
  }
  // 4. 创建仅含本版本的审核集合，最后一步才提交；中途失败保留待核对，不能从头自动重放。
  const review = resource(
    await client.request('POST', '/v1/reviewSubmissions', {
      data: {
        type: 'reviewSubmissions',
        attributes: { platform: 'IOS' },
        relationships: { app: { data: { type: 'apps', id: s.binding.appId } } },
      },
    }),
    'reviewSubmissions',
  )
  const id = appleId(review.id)
  resource(
    await client.request('POST', '/v1/reviewSubmissionItems', {
      data: {
        type: 'reviewSubmissionItems',
        relationships: {
          reviewSubmission: { data: { type: 'reviewSubmissions', id } },
          appStoreVersion: { data: { type: 'appStoreVersions', id: s.version.id } },
        },
      },
    }),
    'reviewSubmissionItems',
  )
  // 在提交前确认集合仍只包含本次版本，防止其他后台操作并入额外待审内容。
  const items = await client.list(`/v1/reviewSubmissions/${id}/items`, {
    include: 'appStoreVersion',
  })
  const relationships = items[0]?.relationships
  const itemVersion = isRecord(relationships) ? relationships.appStoreVersion : null
  if (
    items.length !== 1 ||
    !isRecord(itemVersion) ||
    !isRecord(itemVersion.data) ||
    itemVersion.data.id !== s.version.id
  )
    throw new AppleReviewError('receipt')
  const submitted = resource(
    await client.request('PATCH', `/v1/reviewSubmissions/${id}`, {
      data: { type: 'reviewSubmissions', id, attributes: { submitted: true } },
    }),
    'reviewSubmissions',
    id,
  )
  if (
    !isRecord(submitted.attributes) ||
    !['WAITING_FOR_REVIEW', 'IN_REVIEW', 'COMPLETING', 'COMPLETE'].includes(
      String(submitted.attributes.state),
    )
  )
    throw new AppleReviewError('receipt')
  report('submitted')
  return 'submitted'
}
