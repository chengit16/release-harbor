/** @description 仅浏览器验收使用的隔离工作台，凭据安全库注入内存替身；生产入口不提供模拟开关。 */
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
      // 仅隔离浏览器夹具的固定合成目标可返回替身通过，不调用商店。
      if (task.appId === '999999') {
        await delay(1000)
        return { code: 'verified', artifact: 'passed', authentication: 'passed', target: 'passed' }
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
  async run(_plan, _id, permit) {
    await permit()
    return 'needs_reconciliation'
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
const app = await createApp(projects, {
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
