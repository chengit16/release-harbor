/** @description Apple 审核测试的合成网络与内存材料；只允许固定已知路由，不连接真实 Apple。 */
import { generateKeyPairSync } from 'node:crypto'
import {
  isRecord,
  type ChannelBinding,
  type AppleReviewSnapshot,
} from '../../packages/contracts/src/index.ts'
import { credentialStore } from '../../packages/provider-app-ship/src/credentials.ts'
import {
  appleReviewClient,
  AppleReviewError,
} from '../../packages/provider-app-ship/src/apple-review-client.ts'
import {
  readAppleReviewCatalog,
  inspectAppleReview,
} from '../../packages/provider-app-ship/src/apple-review-source.ts'
import { executeAppleReview } from '../../packages/provider-app-ship/src/apple-review-execution.ts'
import type {
  AppleReviewRunner,
  AppleReviewReply,
  AppleReviewJob,
} from '../../packages/runner-local/src/apple-review-protocol.ts'
import { MemoryCredentialSecrets } from './credential-intake.ts'

/** 可变选项模拟来源变化与部分写入失败，不提供生产环境开关。 */
export function appleReviewNetwork(binding: ChannelBinding, identifier: string) {
  const calls: { method: string; path: string; body: unknown }[] = []
  const options = {
    state: 'PREPARE_FOR_SUBMISSION',
    releaseType: 'AFTER_APPROVAL',
    active: false,
    missingContact: false,
    missingImages: false,
    pictureId: 'I1',
    expired: false,
    buildState: 'VALID',
    encryption: true,
    missingEncryption: false,
    notes: '旧说明',
    failPath: '',
    foreign: false,
    next: false,
    submitState: 'WAITING_FOR_REVIEW',
  }
  const resource = (
    type: string,
    id: string,
    attributes: Record<string, unknown> = {},
    relationships?: unknown,
  ) => ({ type, id, attributes, ...(relationships ? { relationships } : {}) })
  const version = () =>
    resource(
      'appStoreVersions',
      'V1',
      {
        platform: 'IOS',
        versionString: '1.2.3',
        appStoreState: options.state,
        releaseType: options.releaseType,
      },
      { build: { data: { type: 'builds', id: 'B1' } } },
    )
  const build = () =>
    resource(
      'builds',
      'B1',
      {
        version: '42',
        processingState: options.buildState,
        expired: options.expired,
        uploadedDate: '2026-11-01T08:00:00+08:00',
        ...(options.missingEncryption ? {} : { usesNonExemptEncryption: options.encryption }),
      },
      { preReleaseVersion: { data: { type: 'preReleaseVersions', id: 'P1' } } },
    )
  const transport: typeof fetch = async (input, init) => {
    const u = new URL(String(input)),
      path = u.pathname,
      method = init?.method ?? 'GET',
      body: unknown = init?.body ? JSON.parse(String(init.body)) : null
    if (u.origin !== 'https://api.appstoreconnect.apple.com') throw Error('unexpected origin')
    calls.push({ method, path, body })
    if (options.failPath === path)
      return Response.json(
        { errors: [{ detail: 'private contact must not escape' }] },
        { status: 409 },
      )
    if (method === 'GET') {
      if (path === `/v1/apps/${binding.appId}`)
        return Response.json({
          data: resource('apps', binding.appId, {
            bundleId: options.foreign ? 'wrong' : identifier,
          }),
        })
      if (path === `/v1/apps/${binding.appId}/builds`)
        return Response.json({
          data: [build()],
          included: [resource('preReleaseVersions', 'P1', { version: '1.2.3', platform: 'IOS' })],
          links: { next: options.next ? 'https://foreign.test' : null },
        })
      if (path === `/v1/apps/${binding.appId}/appStoreVersions`)
        return Response.json({ data: [version()] })
      if (path === `/v1/apps/${binding.appId}/reviewSubmissions`)
        return Response.json({
          data: options.active
            ? [resource('reviewSubmissions', 'R0', { state: 'READY_FOR_REVIEW' })]
            : [],
        })
      if (path === '/v1/appStoreVersions/V1/appStoreVersionLocalizations')
        return Response.json({
          data: [
            resource('appStoreVersionLocalizations', 'L1', {
              locale: 'zh-Hans',
              description: '合成描述',
              supportUrl: 'https://example.com',
              whatsNew: options.notes,
            }),
          ],
        })
      if (path === '/v1/appStoreVersionLocalizations/L1/appScreenshotSets')
        return Response.json({ data: [resource('appScreenshotSets', 'S1')] })
      if (path === '/v1/appScreenshotSets/S1/appScreenshots')
        return Response.json({
          data: options.missingImages
            ? []
            : [
                resource('appScreenshots', options.pictureId, {
                  assetDeliveryState: { state: 'COMPLETE' },
                }),
              ],
        })
      if (path === '/v1/appStoreVersions/V1/appStoreReviewDetail')
        return Response.json({
          data: resource('appStoreReviewDetails', 'D1', {
            contactFirstName: options.missingContact ? '' : '合成',
            contactLastName: '测试',
            contactEmail: 'synthetic@example.com',
            contactPhone: '123',
            demoAccountRequired: true,
            demoAccountName: 'private-review-login',
            demoAccountPassword: 'private-review-password',
          }),
        })
      if (path === '/v1/reviewSubmissions/R1/items')
        return Response.json({
          data: [
            resource(
              'reviewSubmissionItems',
              'RI1',
              {},
              { appStoreVersion: { data: { type: 'appStoreVersions', id: 'V1' } } },
            ),
          ],
        })
      if (path === '/v1/appStoreVersions/V1/build') return Response.json({ data: build() })
    }
    if (
      method === 'PATCH' &&
      isRecord(body) &&
      isRecord(body.data) &&
      isRecord(body.data.attributes)
    ) {
      if (path === '/v1/appStoreVersions/V1') {
        options.releaseType = String(body.data.attributes.releaseType)
        return Response.json({ data: version() })
      }
      if (path === '/v1/appStoreVersionLocalizations/L1') {
        options.notes = String(body.data.attributes.whatsNew)
        return Response.json({
          data: resource('appStoreVersionLocalizations', 'L1', { whatsNew: options.notes }),
        })
      }
      if (path === '/v1/reviewSubmissions/R1')
        return Response.json({
          data: resource('reviewSubmissions', 'R1', { state: options.submitState }),
        })
    }
    if (method === 'POST') {
      if (path === '/v1/reviewSubmissions')
        return Response.json(
          {
            data: resource('reviewSubmissions', 'R1', {
              platform: 'IOS',
              state: 'READY_FOR_REVIEW',
            }),
          },
          { status: 201 },
        )
      if (path === '/v1/reviewSubmissionItems')
        return Response.json({ data: resource('reviewSubmissionItems', 'RI1') }, { status: 201 })
      if (path === '/v1/appStoreVersionReleaseRequests')
        return Response.json(
          { data: { type: 'appStoreVersionReleaseRequests', id: 'REL1' } },
          { status: 201 },
        )
    }
    throw Error('unexpected fixed route')
  }
  return { options, calls, transport }
}
/** 内存材料经真实 SDK 格式进入可信客户端，测试只使用合成密钥。 */
export async function appleReviewTestClient(
  vault: string,
  binding: ChannelBinding,
  identifier: string,
) {
  const store = credentialStore(vault, new MemoryCredentialSecrets())
  const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    .privateKey.export({ format: 'pem', type: 'pkcs8' })
    .toString()
  await store.saveProfile({
    credentialProfile: binding.credentialReference,
    platform: 'app_store',
    material: {
      fields: { apiKeyId: 'ABC123DE45', apiIssuerId: '11111111-1111-4111-8111-111111111111' },
      files: { privateKey: { content: key } },
    },
  })
  const network = appleReviewNetwork(binding, identifier),
    client = await appleReviewClient(store, binding.credentialReference, network.transport)
  return { ...network, client }
}
/** 仅测试或隔离浏览器装配；生产总是固定独立进程。 */
export class TestAppleReviewRunner implements AppleReviewRunner {
  executes = 0
  constructor(
    private readonly inspect: (job: AppleReviewJob) => Promise<AppleReviewReply>,
    private readonly execute?: (
      s: AppleReviewSnapshot,
      permit: () => Promise<void>,
    ) => Promise<AppleReviewReply>,
  ) {}
  async run(job: AppleReviewJob, permit?: () => Promise<void>): Promise<AppleReviewReply> {
    if (job.kind !== 'execute') return this.inspect(job)
    this.executes++
    return this.execute
      ? this.execute(
          job.snapshot,
          permit ??
            (async () => {
              throw Error()
            }),
        )
      : { ok: false, code: 'interrupted' }
  }
  close(): void {}
}
