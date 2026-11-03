/** @description 冻结、确认、并发取消和依赖失效的端到端测试；合成字节与受控预检端口，不读取真实账号或请求商店。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import {
  isReleasePlan,
  isReleasePlanView,
  type ApplicationPlatform,
  type ProfileCatalog,
  type ReleasePlan,
} from '../packages/contracts/src/index.ts'
import {
  ApplicationCatalog,
  ProjectCatalog,
  notesFingerprint,
  planFingerprint,
  validateReleasePlanInput,
} from '../packages/domain/src/index.ts'
import { FileProjectStore } from '../apps/api/src/project-store.ts'
import { FileApplicationStore } from '../apps/api/src/application-store.ts'
import { FileArtifactStore } from '../apps/api/src/artifact-store.ts'
import { ArtifactsService } from '../apps/api/src/artifacts.service.ts'
import { FilePreflightStore } from '../apps/api/src/preflight-store.ts'
import { PreflightsService } from '../apps/api/src/preflights.service.ts'
import { FileReleasePlanStore } from '../apps/api/src/release-plan-store.ts'
import { ReleasePlansService } from '../apps/api/src/release-plans.service.ts'
import { createApp } from '../apps/api/src/app.ts'

async function setup(t: test.TestContext, platform: ApplicationPlatform = 'ios') {
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
    identifier: 'com.example.plans',
  })
  const channel = platform === 'ios' ? 'app_store' : 'huawei'
  const format = platform === 'ios' ? 'ipa' : 'apk'
  const binding = await catalog.bind('local', project.id, application.id, {
    channel,
    appId: '123456',
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
        return { code: 'verified', artifact: 'passed', authentication: 'passed', target: 'passed' }
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
  const api = await createApp(projects, {
    applicationStore: applications,
    artifacts,
    preflights,
    releasePlans: plans,
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
    action: platform === 'ios' ? 'apple_upload_build' : 'huawei_save_draft',
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

test('冻结只使用服务端事实，重复请求去重；响应和重启保留不可变指纹', async (t) => {
  const f = await setup(t)
  const response = await f.api.inject({
    method: 'POST',
    url: f.base,
    headers: f.headers,
    payload: f.input,
  })
  assert.equal(response.statusCode, 201, response.body)
  const plan: ReleasePlan = response.json().plan
  assert.ok(isReleasePlan(plan))
  assert.equal(plan.status, 'frozen')
  assert.equal(plan.authorization, null)
  assert.equal(plan.digest, planFingerprint(plan.snapshot))
  assert.equal(plan.snapshot.notesDigest, notesFingerprint(f.input.releaseNotes))
  assert.equal(plan.snapshot.artifact.sha256, f.artifact.sha256)
  const duplicate = await f.plans.freeze(...f.args, f.input)
  assert.equal(duplicate.id, plan.id)
  await assert.rejects(
    f.plans.freeze(...f.args, { ...f.input, releaseNotes: '其他说明' }),
    /另一份计划/,
  )
  const disk = await new FileReleasePlanStore(f.file).list(...f.args)
  assert.deepEqual(disk, [plan])
  assert.ok(!JSON.stringify(plan).includes(f.root))
  assert.equal(f.calls(), 1, '冻结和查询不重复请求商店')
  const views = await f.plans.list(...f.args)
  assert.ok(isReleasePlanView(views[0]))
})

test('两种平台的动作严格匹配；未知字段、跨归属和无来源确认被拒绝', async (t) => {
  const f = await setup(t, 'android')
  await assert.rejects(
    f.plans.freeze(...f.args, { ...f.input, action: 'apple_upload_build' }),
    /不匹配/,
  )
  for (const input of [
    { ...f.input, workspaceId: 'other' },
    { ...f.input, action: 'submit_review' },
    { ...f.input, releaseNotes: ' ' },
    { ...f.input, releaseNotes: 'x\x00' },
  ])
    assert.throws(() => validateReleasePlanInput(input))
  const plan = await f.plans.freeze(...f.args, f.input)
  assert.equal(plan.snapshot.action, 'huawei_save_draft')
  const decision = { expectedDigest: plan.digest, acknowledged: true }
  for (const headers of [
    { host: '127.0.0.1' },
    { ...f.headers, origin: 'http://evil.example' },
    { ...f.headers, 'x-release-harbor-plan': '0' },
  ]) {
    assert.equal(
      (
        await f.api.inject({
          method: 'POST',
          url: f.base + '/' + plan.id + '/confirm',
          headers,
          payload: decision,
        })
      ).statusCode,
      403,
    )
  }
  assert.equal(
    (
      await f.api.inject({
        method: 'POST',
        url: f.base + '/' + plan.id + '/confirm',
        headers: f.headers,
        payload: { ...decision, acknowledged: false },
      })
    ).statusCode,
    400,
  )
  await assert.rejects(
    f.plans.confirm(...f.args, plan.id, { ...decision, expectedDigest: 'b'.repeat(64) }),
    /不一致/,
  )
  await assert.rejects(f.plans.confirm('other', f.args[1], f.args[2], plan.id, decision), /不存在/)
  await assert.rejects(f.plans.freeze('local', randomUUID(), f.args[2], f.input), /不存在/)
  assert.equal((await f.store.list(...f.args))[0]?.authorization, null)
})

test('并发确认只生成一次限定授权；取消撤销且重启不重新派发', async (t) => {
  const f = await setup(t)
  const plan = await f.plans.freeze(...f.args, f.input)
  const decision = { expectedDigest: plan.digest, acknowledged: true }
  const results = await Promise.all(
    Array.from({ length: 4 }, () => f.plans.confirm(...f.args, plan.id, decision)),
  )
  assert.equal(new Set(results.map((p) => p.authorization?.id)).size, 1)
  const confirmed = results[0]
  assert.ok(confirmed?.authorization)
  assert.equal(confirmed.authorization.planDigest, plan.digest)
  assert.equal(confirmed.authorization.scope, 'local_once')
  assert.ok(
    Date.parse(confirmed.authorization.expiresAt) <=
      Date.parse(plan.snapshot.preflight.expiresAt ?? ''),
  )
  f.advance(1000)
  const repeated = await f.plans.confirm(...f.args, plan.id, decision)
  assert.deepEqual(repeated.authorization, confirmed.authorization)
  const cancelled = await f.plans.cancel(...f.args, plan.id, { expectedDigest: plan.digest })
  assert.equal(cancelled.status, 'cancelled')
  assert.deepEqual(cancelled.snapshot, plan.snapshot)
  assert.equal((await f.plans.list(...f.args))[0]?.invalidatedBy, 'cancelled')
  await assert.rejects(f.plans.confirm(...f.args, plan.id, decision), /失效/)
  assert.deepEqual(
    await f.plans.cancel(...f.args, plan.id, { expectedDigest: plan.digest }),
    cancelled,
  )
  assert.equal((await new FileReleasePlanStore(f.file).list(...f.args))[0]?.status, 'cancelled')
  assert.equal(f.calls(), 1)
  assert.equal(
    (
      await f.api.inject({
        method: 'POST',
        url: f.base + '/' + plan.id + '/execute',
        headers: f.headers,
        payload: decision,
      })
    ).statusCode,
    404,
  )
})

test('实际产物字节变化使计划与确认失效，数据库摘要未变也不能继续确认', async (t) => {
  const f = await setup(t)
  const plan = await f.plans.freeze(...f.args, f.input)
  await f.plans.confirm(...f.args, plan.id, { expectedDigest: plan.digest, acknowledged: true })
  await writeFile(f.bytes.paths(f.artifact).payload, 'changed-synthetic-artifact')
  assert.equal((await f.plans.list(...f.args))[0]?.invalidatedBy, 'artifact_changed')
  await assert.rejects(
    f.plans.confirm(...f.args, plan.id, { expectedDigest: plan.digest, acknowledged: true }),
    /失效/,
  )
})

test('绑定、目录与有效期变化分别失效，不用旧通过结果替代新意图', async (t) => {
  const f = await setup(t)
  const plan = await f.plans.freeze(...f.args, f.input)
  const profile = f.profiles.profiles[0]
  assert.ok(profile)
  profile.revision = 'b'.repeat(64)
  assert.equal((await f.plans.list(...f.args))[0]?.invalidatedBy, 'profile_changed')
  f.profiles.code = 'storage_unavailable'
  f.profiles.profiles = []
  assert.equal((await f.plans.list(...f.args))[0]?.invalidatedBy, 'profile_unavailable')
  f.profiles.code = 'available'
  f.profiles.profiles = [{ ...profile, revision: 'a'.repeat(64) }]
  f.advance(301000)
  assert.equal((await f.plans.list(...f.args))[0]?.invalidatedBy, 'preflight_expired')
  await assert.rejects(f.plans.freeze(...f.args, { ...f.input, requestId: randomUUID() }), /未过期/)
  f.advance(-301000)
  await f.catalog.updateBinding(...f.args, f.binding.id, {
    appId: '654321',
    credentialReference: f.binding.credentialReference,
    expectedRevision: 1,
  })
  assert.equal((await f.plans.list(...f.args))[0]?.invalidatedBy, 'binding_changed')
  await assert.rejects(
    f.plans.confirm(...f.args, plan.id, { expectedDigest: plan.digest, acknowledged: true }),
    /失效/,
  )
})

test('取消与确认竞争不复活取消计划，损坏快照和文件均拒绝覆盖', async (t) => {
  const f = await setup(t)
  const plan = await f.plans.freeze(...f.args, f.input)
  const results = await Promise.allSettled([
    f.plans.cancel(...f.args, plan.id, { expectedDigest: plan.digest }),
    f.plans.confirm(...f.args, plan.id, { expectedDigest: plan.digest, acknowledged: true }),
  ])
  assert.equal(results[0]?.status, 'fulfilled')
  assert.equal(results[1]?.status, 'rejected')
  const original = await readFile(f.file, 'utf8')
  const tampered = original.replace('修复登录问题', '恶意改写说明')
  await writeFile(f.file, tampered)
  await assert.rejects(f.plans.list(...f.args), /无法读取/)
  await assert.rejects(
    f.plans.freeze(...f.args, { ...f.input, requestId: randomUUID() }),
    /无法读取/,
  )
  assert.equal(await readFile(f.file, 'utf8'), tampered)
  await writeFile(f.file, '{broken')
  await assert.rejects(f.store.list(...f.args), /无法读取/)
  assert.equal(await readFile(f.file, 'utf8'), '{broken')
})
