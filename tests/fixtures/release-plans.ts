/** @description 发布执行测试的隔离存储与受控端口，供计划和核对合同测试复用。 */
import { vivoDetails } from './vivo.ts'
import { oppoDetails } from './oppo.ts'
import { xiaomiDetails } from './xiaomi.ts'
import { ReleasePreparationsService } from '../../apps/api/src/release-preparations.service.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import type {
  ApplicationPlatform,
  BindingChannel,
  ProfileCatalog,
} from '../../packages/contracts/src/index.ts'
import { ApplicationCatalog, ProjectCatalog } from '../../packages/domain/src/index.ts'
import { FileProjectStore } from '../../apps/api/src/project-store.ts'
import { FileApplicationStore } from '../../apps/api/src/application-store.ts'
import { FileArtifactStore } from '../../apps/api/src/artifact-store.ts'
import { ArtifactsService } from '../../apps/api/src/artifacts.service.ts'
import { FilePreflightStore } from '../../apps/api/src/preflight-store.ts'
import { PreflightsService } from '../../apps/api/src/preflights.service.ts'
import { FileReleasePlanStore } from '../../apps/api/src/release-plan-store.ts'
import { ReleasePlansService } from '../../apps/api/src/release-plans.service.ts'
import { createApp } from '../../apps/api/src/app.ts'

import { ReleaseExecutionService } from '../../apps/api/src/release-execution.service.ts'
import type { ReleaseExecutor } from '../../packages/runner-local/src/index.ts'

/** 隔离文件、合成产物和注入执行端口，绝不请求真实商店。 */
export async function setup(
  t: test.TestContext,
  platform: ApplicationPlatform = 'ios',
  executor?: ReleaseExecutor,
  options?: {
    channel?: BindingChannel
    check?: () => Promise<import('../../packages/runner-local/src/index.ts').PreflightOutcome>
  },
) {
  const root = await mkdtemp(join(tmpdir(), 'harbor-plan-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const projects = new FileProjectStore(join(root, 'projects.json'))
  const project = await new ProjectCatalog(projects).create('local', {
    name: '计划测试',
    key: 'plans-test',
    framework: 'native',
  })
  const applications = new FileApplicationStore(join(root, 'applications.json'))
  const catalog = new ApplicationCatalog(projects, applications)
  const application = await catalog.create('local', project.id, {
    name: '合成应用',
    platform,
    identifier: platform === 'android' ? 'com.example.android' : 'com.example.plans',
  })
  const channel = options?.channel ?? (platform === 'ios' ? 'app_store' : 'huawei')
  const format = platform === 'ios' ? 'ipa' : 'apk'
  const binding = await catalog.bind('local', project.id, application.id, {
    channel,
    appId:
      channel === 'xiaomi' || channel === 'oppo' || channel === 'vivo'
        ? application.identifier
        : '123456',
    credentialReference: 'synthetic-plan-account',
  })
  const bytes = new FileArtifactStore(join(root, 'artifacts'))
  const artifacts = new ArtifactsService(catalog, bytes, {
    async inspect(task) {
      return {
        failureCode: null,
        identity: {
          format,
          packageName: application.identifier,
          versionName: '1.2.3',
          buildNumber: '42',
          sha256: task.sha256,
          sizeBytes: task.sizeBytes,
        },
      }
    },
    close() {},
  })
  let calls = 0
  const profiles: ProfileCatalog = {
    code: 'available',
    profiles: [
      {
        reference: binding.credentialReference,
        channel,
        configured: true,
        revision: 'a'.repeat(64),
      },
    ],
  }
  const preflights = new PreflightsService(
    catalog,
    artifacts,
    bytes,
    new FilePreflightStore(join(root, 'preflights.json')),
    {
      async catalog() {
        return profiles
      },
      async check() {
        calls++
        if (options?.check) return options.check()
        return {
          code: 'verified',
          artifact: 'passed',
          authentication: 'passed',
          target: 'passed',
          ...(channel === 'xiaomi' ? { xiaomi: xiaomiDetails } : {}),
          ...(channel === 'vivo' ? { vivo: vivoDetails } : {}),
          ...(channel === 'oppo' ? { oppo: oppoDetails } : {}),
        }
      },
      close() {},
    },
  )
  let now = Date.now()
  const file = join(root, 'release-plans.json')
  const store = new FileReleasePlanStore(file)
  const plans = new ReleasePlansService(
    catalog,
    artifacts,
    preflights,
    store,
    ['http://127.0.0.1:5178'],
    () => now,
  )
  const execution = new ReleaseExecutionService(
    store,
    plans,
    executor ?? {
      async run() {
        return 'verification_failed'
      },
      close() {},
    },
    () => now,
  )
  const preparations = new ReleasePreparationsService(catalog, artifacts, preflights, plans, store)
  const api = await createApp(projects, {
    applicationStore: applications,
    artifacts,
    preflights,
    releasePlans: plans,
    execution,
    preparations,
  })
  t.after(() => api.close())
  const content = Buffer.from('isolated-synthetic-plan-bytes')
  const received = await artifacts.receive(
    'local',
    project.id,
    application.id,
    'synthetic.' + format,
    content.length,
    Readable.from(content),
  )
  let artifact = await artifacts.get('local', project.id, application.id, received.id)
  for (let i = 0; artifact.status === 'checking' && i < 100; i++) {
    await delay(5)
    artifact = await artifacts.get('local', project.id, application.id, received.id)
  }
  assert.equal(artifact.status, 'ready')
  const check = await preflights.start('local', project.id, application.id, {
    bindingId: binding.id,
    artifactId: artifact.id,
    expectedBindingRevision: 1,
    expectedProfileRevision: 'a'.repeat(64),
  })
  for (let i = 0; i < 100; i++) {
    if ((await preflights.list('local', project.id, application.id))[0]?.current) break
    await delay(5)
  }
  const input = {
    requestId: randomUUID(),
    preflightId: check.id,
    action:
      channel === 'vivo'
        ? 'vivo_submit_review'
        : channel === 'oppo'
          ? 'oppo_submit_review'
          : channel === 'xiaomi'
            ? 'xiaomi_submit_review'
            : platform === 'ios'
              ? 'apple_upload_build'
              : 'huawei_save_draft',
    releasePolicy: { mode: 'after_approval' },
    releaseNotes: '修复登录问题\n优化启动速度',
  }
  const args = ['local', project.id, application.id] as const
  const base = `/api/projects/${project.id}/applications/${application.id}/release-plans`
  const headers = {
    host: '127.0.0.1',
    origin: 'http://127.0.0.1:5178',
    'x-release-harbor-plan': '1',
  }
  return {
    root,
    file,
    store,
    execution,
    preparations,
    preflights,
    artifacts,
    plans,
    profiles,
    catalog,
    application,
    binding,
    artifact,
    bytes,
    input,
    args,
    api,
    base,
    headers,
    calls: () => calls,
    advance: (ms: number) => {
      now += ms
    },
  }
}

/** 为当前合成预检冻结并明确确认。 */
export async function confirmed(f: Awaited<ReturnType<typeof setup>>) {
  const p = await f.plans.freeze(...f.args, f.input)
  return f.plans.confirm(...f.args, p.id, { expectedDigest: p.digest, acknowledged: true })
}
/** 等待测试执行落到终态，不触发重新派发。 */
export async function terminal(f: Awaited<ReturnType<typeof setup>>) {
  for (let n = 0; n < 100; n++) {
    const a = (await f.execution.list(...f.args))[0]
    if (a?.finishedAt) return a
    await delay(5)
  }
  throw new Error('执行未结束')
}
