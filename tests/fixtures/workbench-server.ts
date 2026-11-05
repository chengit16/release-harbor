/** @description 仅浏览器验收使用的隔离工作台，凭据安全库注入内存替身；生产入口不提供模拟开关。 */
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
import { setTimeout as delay } from 'node:timers/promises'
import { randomUUID } from 'node:crypto'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
        (task.channel === 'xiaomi' && task.appId === 'com.example.xiaomi') ||
        (task.channel === 'oppo' && task.appId === 'com.example.oppo') ||
        (task.channel === 'vivo' && task.appId === 'com.example.vivo') ||
        ((task.channel === 'tencent' ||
          task.channel === 'harmony' ||
          task.channel === 'meizu' ||
          task.channel === 'honor') &&
          task.appId === '123456' &&
          task.inspection.target.identifier === `com.example.${task.channel}`)
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
  async run(_plan, _id, permit, report) {
    await permit()
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
const app = await createApp(projects, {
  appleReview,
  applicationStore: applications,
  artifacts,
  credentialAccounts: accounts,
  preflights,
  releasePlans: plans,
  execution,
  preparations,
  webRoot: fileURLToPath(new URL('../../apps/web/dist', import.meta.url)),
})
app.enableShutdownHooks()
await app.listen(port, '127.0.0.1')
