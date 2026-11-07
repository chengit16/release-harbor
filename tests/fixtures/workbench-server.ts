/** @description 仅浏览器验收使用的隔离工作台，凭据安全库注入内存替身；生产入口不提供模拟开关。 */
import { setTimeout as delay } from 'node:timers/promises'
import { randomUUID } from 'node:crypto'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ReleaseObservationService } from '../../apps/api/src/release-observation.service.ts'
import { ReleaseObservationStore } from '../../apps/api/src/release-observation-store.ts'
import { ReleaseBatchesService } from '../../apps/api/src/release-batches.service.ts'
import { AppleReviewService } from '../../apps/api/src/apple-review.service.ts'
import { appleReviewTestClient } from './apple-review.ts'
import { profileRevision } from '../../packages/provider-app-ship/src/credentials.ts'
import {
  readAppleReviewCatalog,
  inspectAppleReview,
} from '../../packages/provider-app-ship/src/apple-review-source.ts'
import { executeAppleReview } from '../../packages/provider-app-ship/src/apple-review-execution.ts'
import { AppleReviewError } from '../../packages/provider-app-ship/src/apple-review-client.ts'
import type { AppleReviewRunner } from '../../packages/runner-local/src/apple-review-protocol.ts'
import { tencentDetails, harmonyDetails } from './tencent-harmony.ts'
import { meizuDetails, honorDetails } from './store-updates.ts'
import { vivoDetails } from './vivo.ts'
import { oppoDetails } from './oppo.ts'
import { xiaomiDetails } from './xiaomi.ts'
import { ReleasePreparationsService } from '../../apps/api/src/release-preparations.service.ts'
import { ReleaseExecutionService } from '../../apps/api/src/release-execution.service.ts'
import { StoreStatusService } from '../../apps/api/src/store-status.service.ts'
import { StoreStatusStore } from '../../apps/api/src/store-status-store.ts'
import { createApp } from '../../apps/api/src/app.ts'
import { FileProjectStore } from '../../apps/api/src/project-store.ts'
import { FileApplicationStore } from '../../apps/api/src/application-store.ts'
import { FileArtifactStore } from '../../apps/api/src/artifact-store.ts'
import { ArtifactsService } from '../../apps/api/src/artifacts.service.ts'
import { CredentialAccountsService } from '../../apps/api/src/credential-accounts.service.ts'
import { PreflightsService } from '../../apps/api/src/preflights.service.ts'
import { FilePreflightStore } from '../../apps/api/src/preflight-store.ts'
import { ApplicationCatalog } from '../../packages/domain/src/index.ts'
import { LocalArtifactInspector } from '../../packages/runner-local/src/index.ts'
import { TestCredentialIntake } from './credential-intake.ts'
import { FileReleasePlanStore } from '../../apps/api/src/release-plan-store.ts'
import { ReleasePlansService } from '../../apps/api/src/release-plans.service.ts'

const root = process.env.RELEASE_HARBOR_DATA_DIR
if (!root || !basename(root).startsWith('release-harbor-ui-'))
  throw new Error('浏览器夹具只接受显式隔离临时目录')
const port = Number(process.env.RELEASE_HARBOR_PORT || 4401)
const origins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`]
const projects = new FileProjectStore(join(root, 'projects.json'))
const applications = new FileApplicationStore(join(root, 'applications.json'))
const catalog = new ApplicationCatalog(projects, applications)
const bytes = new FileArtifactStore(join(root, 'artifacts'))
const artifacts = new ArtifactsService(catalog, bytes, new LocalArtifactInspector())
const intake = new TestCredentialIntake(root, origins)
// 合成失败意图没有 SDK 材料，用于浏览器复现用户的待核对卡片及重新录入路径。
await intake.store.save({
  id: randomUUID(),
  reference: 'profile-' + randomUUID(),
  channel: 'huawei',
  displayName: '待核对验收账号',
  status: 'saving',
  code: 'saving',
  createdAt: new Date().toISOString(),
})
const accounts = new CredentialAccountsService(intake, origins, projects, applications)
const preflights = new PreflightsService(
  catalog,
  artifacts,
  bytes,
  new FilePreflightStore(join(root, 'preflights.json')),
  {
    catalog: () => intake.repository.catalog(),
    // 合成账号只验证界面失败反馈，不调用真实商店或伪造商店成功。
    async check(task) {
      // 固定合成目标复现魅族历史版本推荐语为空，验证具体原因到准备页的投影，不连接商店。
      if (
        task.channel === 'meizu' &&
        task.appId === '123457' &&
        task.inspection.target.identifier === 'com.example.meizu'
      )
        return {
          code: 'meizu_recommendation_missing',
          artifact: 'passed',
          authentication: 'passed',
          target: 'unverified',
        }
      // 仅隔离浏览器夹具的固定合成目标可返回替身通过，不调用商店。
      if (
        task.appId === '999999' ||
        (['huawei', 'meizu'].includes(task.channel) &&
          ['999998', '123458'].includes(task.appId) &&
          task.inspection.target.identifier === 'com.example.batch') ||
        (task.channel === 'xiaomi' && task.appId === 'com.example.xiaomi') ||
        (task.channel === 'oppo' && task.appId === 'com.example.oppo') ||
        (task.channel === 'vivo' && task.appId === 'com.example.vivo') ||
        ((task.channel === 'tencent' ||
          task.channel === 'harmony' ||
          task.channel === 'meizu' ||
          task.channel === 'honor') &&
          task.appId === '123456' &&
          (task.inspection.target.identifier === `com.example.${task.channel}` ||
            (task.channel === 'meizu' &&
              task.inspection.target.identifier === 'com.example.batch')))
      ) {
        await delay(1000)
        return {
          code: 'verified',
          artifact: 'passed',
          authentication: 'passed',
          target: 'passed',
          ...(task.channel === 'tencent' ? { tencent: tencentDetails } : {}),
          ...(task.channel === 'harmony' ? { harmony: harmonyDetails } : {}),
          ...(task.channel === 'meizu' ? { meizu: meizuDetails } : {}),
          ...(task.channel === 'honor' ? { honor: honorDetails } : {}),
          ...(task.channel === 'vivo' ? { vivo: vivoDetails } : {}),
          ...(task.channel === 'oppo' ? { oppo: oppoDetails } : {}),
          ...(task.channel === 'xiaomi'
            ? {
                xiaomi: {
                  ...xiaomiDetails,
                  source: {
                    kind: 'xiaomi_public_listing',
                    url: 'https://app.mi.com/details?id=com.example.xiaomi',
                    checkedAt: new Date().toISOString(),
                  },
                },
              }
            : {}),
        }
      }
      return {
        code: 'credentials_unavailable',
        artifact: 'unverified',
        authentication: 'unverified',
        target: 'unverified',
      }
    },
    close() {},
  },
  accounts,
)
const planStore = new FileReleasePlanStore(join(root, 'release-plans.json'))
const plans = new ReleasePlansService(catalog, artifacts, preflights, planStore, origins)
const execution = new ReleaseExecutionService(planStore, plans, {
  async run(_plan, _id, permit, report, batch, onReviewAnchor) {
    // 批次夹具保留许可前等待，真实浏览器可以验证停止先于 grant；不访问商店。
    if (batch) await delay(1000)
    await permit(
      batch
        ? {
            batchId: batch.batchId,
            revisionId: batch.revisionId,
            targetId: batch.targetId,
            attemptId: _id,
            planDigest: _plan.digest,
            checkedAt: new Date().toISOString(),
            profileRevision: _plan.snapshot.preflight.profileRevision,
            artifactSha256: _plan.snapshot.artifact.sha256 ?? '',
            scope: 'artifact_profile_merchant_source',
          }
        : undefined,
    )
    if (_plan.snapshot.action === 'meizu_submit_review')
      onReviewAnchor?.({ channel: 'meizu', versionId: '200' })
    // 只在隔离夹具模拟超时，以验证具体原因跨控制面进入页面，绝不连接商店。
    if (_plan.snapshot.action === 'huawei_save_draft') report?.('upload_timeout')
    return _plan.snapshot.action === 'apple_upload_build'
      ? 'build_processing'
      : _plan.snapshot.action === 'tencent_submit_review'
        ? 'tencent_review_submitted'
        : _plan.snapshot.action === 'harmony_submit_review'
          ? 'harmony_review_submitted'
          : _plan.snapshot.action === 'meizu_submit_review'
            ? 'meizu_review_submitted'
            : _plan.snapshot.action === 'honor_submit_review'
              ? 'honor_review_submitted'
              : _plan.snapshot.action === 'vivo_submit_review'
                ? 'vivo_update_accepted'
                : _plan.snapshot.action === 'oppo_submit_review'
                  ? 'oppo_version_processed'
                  : _plan.snapshot.action === 'xiaomi_submit_review'
                    ? 'review_submitted'
                    : 'needs_reconciliation'
  },
  close() {},
})
const preparations = new ReleasePreparationsService(
  catalog,
  artifacts,
  preflights,
  plans,
  planStore,
)
// 仅隔离浏览器夹具的固定合成 Apple 目标；生产没有模拟审核或批准开关。
const appleClients = new Map<string, Awaited<ReturnType<typeof appleReviewTestClient>>>()
const appleRunner: AppleReviewRunner = {
  async run(job, permit) {
    const binding = job.kind === 'execute' ? job.snapshot.binding : job.binding
    const identifier = job.kind === 'execute' ? job.snapshot.identifier : job.identifier
    if (binding.appId !== '200002' || identifier !== 'com.example.ios')
      return { ok: false, code: 'target' }
    try {
      let n = appleClients.get(binding.id)
      if (!n) {
        n = await appleReviewTestClient(
          join(root, 'apple-review-test', binding.id, 'profiles.json'),
          binding,
          identifier,
        )
        appleClients.set(binding.id, n)
      }
      if (job.kind === 'catalog')
        return { ok: true, value: await readAppleReviewCatalog(n.client, binding, identifier) }
      if (job.kind === 'prepare')
        return {
          ok: true,
          value: (
            await inspectAppleReview(
              n.client,
              binding,
              identifier,
              job.buildId,
              job.versionId,
              job.action,
              job.mode,
              job.notes,
              await profileRevision(join(root, 'credentials', 'profiles.json')),
            )
          ).snapshot,
        }
      const result = await executeAppleReview(
        n.client,
        job.snapshot,
        permit ??
          (async () => {
            throw Error()
          }),
        () => undefined,
      )
      if (result === 'submitted') {
        n.options.state = 'PENDING_DEVELOPER_RELEASE'
        n.options.releaseType = job.snapshot.mode === 'manual' ? 'MANUAL' : 'AFTER_APPROVAL'
      } else n.options.state = 'READY_FOR_SALE'
      return { ok: true, value: result }
    } catch (e) {
      return { ok: false, code: e instanceof AppleReviewError ? e.code : 'network' }
    }
  },
  close() {},
}
const appleReview = new AppleReviewService(catalog, preflights, planStore, appleRunner)
const batches = new ReleaseBatchesService(
  catalog,
  artifacts,
  preparations,
  plans,
  execution,
  planStore,
)
const app = await createApp(projects, {
  appleReview,
  storeStatus: new StoreStatusService(
    projects,
    catalog,
    new StoreStatusStore(join(root, 'store-status.json')),
    {
      async run(job) {
        // 仅隔离浏览器夹具返回合成目录，不调用商店；没有本机发布也可查询。
        const version = {
          versionId: '300',
          versionName: '3.0.0',
          buildNumber: null,
          state: 'in_review' as const,
          rawState: 20,
        }
        if (job.binding.credentialReference === 'synthetic-tracking-account') {
          if (job.materialVersionId) {
            const versionId = job.materialVersionId
            return {
              bindingId: job.binding.id,
              channel: 'app_store',
              checkedAt: new Date().toISOString(),
              materialVersionId: versionId,
              code: 'observed',
              versions: [
                {
                  versionId,
                  versionName: versionId === '402' ? '4.1.0' : '4.0.0',
                  buildNumber: versionId === '401' ? '40' : null,
                  state: versionId === '402' ? 'draft' : 'rejected',
                  rawState: null,
                },
              ],
              materials: {
                checks: {
                  build: versionId === '402' ? 'missing' : 'present',
                  description: 'missing',
                  support_url: 'present',
                  screenshots: 'missing',
                  review_contact: 'present',
                  demo_access: 'missing',
                  privacy: 'unchecked',
                  compliance: 'unchecked',
                },
              },
            }
          }
          return {
            bindingId: job.binding.id,
            channel: job.binding.channel,
            checkedAt: new Date().toISOString(),
            code: 'observed',
            ...(job.query ? { query: job.query } : {}),
            versions:
              job.binding.channel === 'app_store'
                ? [
                    {
                      ...version,
                      versionId: '401',
                      versionName: '4.0.0',
                      buildNumber: '40',
                      state: 'pending_manual_release',
                    },
                    { ...version, versionId: '402', versionName: '4.1.0', state: 'draft' },
                    {
                      ...version,
                      versionId: '403',
                      versionName: '3.0.0',
                      buildNumber: '30',
                      state: 'superseded',
                    },
                  ]
                : [
                    {
                      ...version,
                      buildNumber: job.query?.buildNumber ?? '30',
                      state: job.binding.channel === 'oppo' ? 'rejected' : 'published',
                    },
                  ],
          }
        }
        return {
          bindingId: job.binding.id,
          channel: job.binding.channel,
          checkedAt: new Date().toISOString(),
          code: job.binding.channel === 'app_store' ? 'request_rejected' : 'observed',
          versions:
            job.binding.channel === 'app_store'
              ? []
              : job.binding.channel === 'xiaomi'
                ? [{ ...version, state: 'published', rawState: null }]
                : job.binding.channel === 'huawei'
                  ? [
                      { ...version, state: 'in_review' },
                      {
                        ...version,
                        versionId: '200',
                        versionName: '2.0.0',
                        buildNumber: '20',
                        state: 'published',
                        rawState: null,
                      },
                      {
                        ...version,
                        versionId: '100',
                        versionName: '1.0.0',
                        state: 'published',
                        rawState: null,
                      },
                    ]
                  : job.binding.channel === 'oppo'
                    ? [{ ...version, state: 'rejected', rawState: 444 }]
                    : job.binding.channel === 'tencent'
                      ? [
                          {
                            ...version,
                            versionId: null,
                            versionName: null,
                            state: 'approved',
                            rawState: 3,
                          },
                          { ...version, state: 'unknown', rawState: null },
                        ]
                      : [
                          version,
                          {
                            ...version,
                            versionId: '90',
                            versionName: '0.9.0',
                            state: 'superseded',
                            rawState: null,
                          },
                        ],
        }
      },
      close() {},
    },
    origins,
  ),
  observations: new ReleaseObservationService(
    catalog,
    planStore,
    new ReleaseObservationStore(join(root, 'release-observations.json')),
    {
      async run(job) {
        return {
          state: 'rejected',
          code: 'observed',
          rawState: job.binding.channel === 'meizu' ? 30 : 2,
        }
      },
      close() {},
    },
  ),
  applicationStore: applications,
  artifacts,
  credentialAccounts: accounts,
  preflights,
  releasePlans: plans,
  execution,
  preparations,
  batches,
  webRoot: fileURLToPath(new URL('../../apps/web/dist', import.meta.url)),
})
app.enableShutdownHooks()
await app.listen(port, '127.0.0.1')
