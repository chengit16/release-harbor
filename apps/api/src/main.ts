/** @description 本机服务入口，集中读取运行配置并装配持久化，不开放公网监听。 */
import { runtimeTools } from '@release-harbor/runner-local'
import { LocalProductivityService } from './local-productivity.service.ts'
import { localDataRoot } from './local-backup.ts'
import { localRuntime } from './local-runtime.ts'
import { RecoverySafety } from './recovery-safety.ts'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { LocalReleaseObservationRunner } from '@release-harbor/runner-local'
import { LocalAppleReviewRunner } from '@release-harbor/runner-local'
import { LocalReleaseExecutor } from '@release-harbor/runner-local'
import { ApplicationCatalog } from '@release-harbor/domain'
import {
  LocalArtifactInspector,
  LocalPreflightRunner,
  LocalCredentialIntake,
} from '@release-harbor/runner-local'
import { ReleaseObservationService } from './release-observation.service.ts'
import { ReleaseObservationStore } from './release-observation-store.ts'
import { ReleaseBatchesService } from './release-batches.service.ts'
import { AppleReviewService } from './apple-review.service.ts'
import { ReleasePreparationsService } from './release-preparations.service.ts'
import { ReleaseExecutionService } from './release-execution.service.ts'
import { FileProjectStore } from './project-store.ts'
import { createApp } from './app.ts'
import { FileApplicationStore } from './application-store.ts'
import { FileArtifactStore } from './artifact-store.ts'
import { ArtifactsService } from './artifacts.service.ts'
import { FilePreflightStore } from './preflight-store.ts'
import { PreflightsService } from './preflights.service.ts'
import { CredentialAccountsService } from './credential-accounts.service.ts'
import { FileReleasePlanStore } from './release-plan-store.ts'
import { ReleasePlansService } from './release-plans.service.ts'
import { StoreStatusService } from './store-status.service.ts'
import { StoreStatusStore } from './store-status-store.ts'
import { LocalStoreStatusRunner } from '@release-harbor/runner-local'

const mode = process.env.RELEASE_HARBOR_MODE || 'local'
const port = Number(process.env.RELEASE_HARBOR_PORT || 4399)
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('端口必须为 1024–65535 的整数')
const dataRoot = process.env.RELEASE_HARBOR_DATA_DIR || join(homedir(), '.release-harbor')
async function startService(): Promise<void> {
  const { data: businessRoot, installation } = await localDataRoot(dataRoot)
  const safety = new RecoverySafety(join(dataRoot, '.local', 'release-safety.json'))
  const webRoot = fileURLToPath(new URL('../../web/dist', import.meta.url))
  const projects = new FileProjectStore(join(businessRoot, 'projects.json'))
  const applications = new FileApplicationStore(join(businessRoot, 'applications.json'))
  const catalog = new ApplicationCatalog(projects, applications)
  const artifactStore = new FileArtifactStore(join(businessRoot, 'artifacts'))
  const artifacts = new ArtifactsService(catalog, artifactStore, new LocalArtifactInspector())
  const origins = [
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    'http://127.0.0.1:5178',
    'http://localhost:5178',
  ]
  const credentialAccounts = new CredentialAccountsService(
    new LocalCredentialIntake(resolve(dataRoot), origins),
    origins,
    projects,
    applications,
  )
  const preflights = new PreflightsService(
    catalog,
    artifacts,
    artifactStore,
    new FilePreflightStore(join(businessRoot, 'preflights.json')),
    new LocalPreflightRunner(resolve(dataRoot, 'credentials', 'profiles.json')),
    credentialAccounts,
  )
  const planStore = new FileReleasePlanStore(join(businessRoot, 'release-plans.json'), safety)
  const plans = new ReleasePlansService(catalog, artifacts, preflights, planStore, origins)
  const execution = new ReleaseExecutionService(
    planStore,
    plans,
    new LocalReleaseExecutor(
      resolve(businessRoot, 'artifacts'),
      resolve(dataRoot, 'credentials/profiles.json'),
    ),
  )
  const preparations = new ReleasePreparationsService(
    catalog,
    artifacts,
    preflights,
    plans,
    planStore,
  )
  const batches = new ReleaseBatchesService(
    catalog,
    artifacts,
    preparations,
    plans,
    execution,
    planStore,
  )
  const storeStatus = new StoreStatusService(
    projects,
    catalog,
    new StoreStatusStore(join(businessRoot, 'store-status.json')),
    new LocalStoreStatusRunner(resolve(dataRoot, 'credentials/profiles.json')),
    [...origins, 'https://6e03b6cd.r20.vip.cpolar.cn'],
    async (reference) => {
      const directory = await preflights.profiles()
      const profile = directory.profiles.find((p) => p.reference === reference && p.configured)
      if (!profile) throw Error('账号目录不可用')
      return profile.revision
    },
  )
  const localEfficiency = localRuntime(
    dataRoot,
    businessRoot,
    installation,
    storeStatus,
    credentialAccounts,
    origins,
    safety,
    () => {
      void app
        .close()
        .then(() => startService())
        .catch(() => {
          console.error('恢复后服务重建失败，请重新启动项目')
          process.exitCode = 1
        })
    },
  )
  const app = await createApp(projects, {
    applicationStore: applications,
    artifacts,
    preflights,
    releasePlans: plans,
    execution,
    preparations,
    batches,
    credentialAccounts,
    observations: new ReleaseObservationService(
      catalog,
      planStore,
      new ReleaseObservationStore(join(businessRoot, 'release-observations.json')),
      new LocalReleaseObservationRunner(resolve(dataRoot, 'credentials/profiles.json')),
    ),
    appleReview: new AppleReviewService(
      catalog,
      preflights,
      planStore,
      new LocalAppleReviewRunner(resolve(dataRoot, 'credentials/profiles.json')),
    ),
    storeStatus,
    localEfficiency,
    productivity: new LocalProductivityService(
      projects,
      catalog,
      artifactStore,
      planStore,
      localEfficiency,
      runtimeTools,
    ),
    mode,
    webRoot: existsSync(webRoot) ? webRoot : undefined,
  })
  app.enableShutdownHooks()
  await app.listen(port, '127.0.0.1')
  console.log(`Release Harbor API 已启动：http://127.0.0.1:${port}`)
}
await startService()
