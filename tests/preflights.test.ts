/** @description 只读预检的秘密隔离、只读网络、归属、失效与恢复验收；全部凭据和 HTTP 均为合成替身。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import {
  isPreflightRecord,
  isPreflightView,
  type ProfileCatalog,
  type PreflightRecord,
} from '../packages/contracts/src/index.ts'
import {
  credentialStore,
  profileCatalog,
  checkMerchant,
  readonlyTransport,
} from '../packages/provider-app-ship/src/credentials.ts'
import {
  ApplicationCatalog,
  ProjectCatalog,
  preflightView,
  validatePreflightInput,
} from '../packages/domain/src/index.ts'
import {
  LocalArtifactInspector,
  LocalPreflightRunner,
  type PreflightRunner,
  type PreflightOutcome,
  type PreflightTask,
} from '../packages/runner-local/src/index.ts'
import { isPreflightTask } from '../packages/runner-local/src/preflight-protocol.ts'
import { checkPreflight } from '../packages/runner-local/src/check-preflight.ts'
import { FileProjectStore } from '../apps/api/src/project-store.ts'
import { FileApplicationStore } from '../apps/api/src/application-store.ts'
import { FileArtifactStore } from '../apps/api/src/artifact-store.ts'
import { ArtifactsService } from '../apps/api/src/artifacts.service.ts'
import { FilePreflightStore } from '../apps/api/src/preflight-store.ts'
import { PreflightsService } from '../apps/api/src/preflights.service.ts'
import { createApp } from '../apps/api/src/app.ts'
import { syntheticIpa } from './fixtures/ipa.ts'

class MemorySecrets {
  values = new Map<string, string>()
  reads = 0
  async getSecret(account: string): Promise<string | undefined> {
    this.reads++
    return this.values.get(account)
  }
  async setSecret(account: string, secret: string): Promise<void> {
    this.values.set(account, secret)
  }
  async deleteSecret(account: string): Promise<boolean> {
    return this.values.delete(account)
  }
}

async function temporary(t: test.TestContext, cleanup = true): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'harbor-preflight-test-')))
  if (cleanup) t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

test('凭据目录不解密，标量不落盘，Apple 文件只保存密文；重复引用不覆盖', async (t) => {
  const root = await temporary(t)
  const file = join(root, 'credentials', 'profiles.json')
  const secrets = new MemorySecrets()
  const store = credentialStore(file, secrets)
  await store.saveProfile({
    credentialProfile: 'synthetic-huawei',
    platform: 'huawei',
    material: {
      fields: { clientId: 'synthetic-client', clientSecret: 'synthetic-' + 'secret-only' },
    },
  })
  const before = await profileCatalog(file, store)
  const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString()
  await store.saveProfile({
    credentialProfile: 'synthetic-apple',
    platform: 'app_store',
    material: {
      fields: { apiIssuerId: '11111111-1111-4111-8111-111111111111', apiKeyId: 'ABCDEFGHIJ' },
      files: { privateKey: { content: key } },
    },
  })
  const reads = secrets.reads
  const catalog = await profileCatalog(file, store)
  assert.equal(secrets.reads, reads, '目录不能读安全库')
  assert.equal(catalog.profiles.length, 2)
  assert.notEqual(before.profiles[0]?.revision, catalog.profiles[0]?.revision)
  const disk = await readFile(file, 'utf8')
  for (const value of [
    'synthetic-secret-only',
    'synthetic-client',
    key,
    '11111111-1111-4111-8111-111111111111',
  ])
    assert.ok(!disk.includes(value))
  assert.ok(!JSON.stringify(catalog).includes('privateKey'))
  await assert.rejects(
    store.saveProfile({
      credentialProfile: 'synthetic-huawei',
      platform: 'huawei',
      material: { fields: {} },
    }),
  )
  await writeFile(file, 'broken', { mode: 0o600 })
  assert.deepEqual(await profileCatalog(file, store), { code: 'storage_unavailable', profiles: [] })
})

test('华为预检只有固定鉴权及查询，匹配 appId 才通过；网络错误不输出原文', async (t) => {
  const file = join(await temporary(t), 'profiles.json')
  const store = credentialStore(file, new MemorySecrets())
  await store.saveProfile({
    credentialProfile: 'synthetic-huawei',
    platform: 'huawei',
    material: { fields: { clientId: 'synthetic-id', clientSecret: 'synthetic-secret' } },
  })
  const calls: string[] = []
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input))
    calls.push(`${init?.method ?? 'GET'} ${url.origin}${url.pathname}`)
    assert.equal(init?.redirect, 'error')
    return Response.json(
      init?.method === 'POST'
        ? { access_token: 'synthetic-bearer' }
        : { ret: { code: 0 }, appids: [{ value: '123456' }] },
    )
  }
  const input = {
    channel: 'huawei' as const,
    reference: 'synthetic-huawei',
    identifier: 'com.example.test',
    appId: '123456',
  }
  assert.deepEqual(await checkMerchant(input, store, transport), {
    code: 'verified',
    authentication: 'passed',
    target: 'passed',
  })
  assert.equal(calls.length, 2)
  assert.ok(calls[0]?.startsWith('POST https://connect-api.cloud.huawei.com/'))
  assert.equal(
    (await checkMerchant({ ...input, appId: '9999' }, store, transport)).code,
    'application_mismatch',
  )
  assert.equal(
    (
      await checkMerchant(input, store, async () => {
        throw new Error('synthetic-secret')
      })
    ).code,
    'network_unavailable',
  )
  let sent = false
  await assert.rejects(
    readonlyTransport('huawei', async () => {
      sent = true
      return Response.json({})
    })('https://connect-api.cloud.huawei.com/api/publish/v2/upload', { method: 'POST' }),
  )
  await assert.rejects(readonlyTransport('app_store', transport)('https://evil.example/v1/apps'))
  assert.equal(sent, false)
})

test('Apple 只读 API Key 匹配 Bundle ID 和 App ID；密码方式保持无法验证', async (t) => {
  const store = credentialStore(join(await temporary(t), 'profiles.json'), new MemorySecrets())
  const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString()
  await store.saveProfile({
    credentialProfile: 'apple-api',
    platform: 'app_store',
    material: {
      fields: { apiIssuerId: '11111111-1111-4111-8111-111111111111', apiKeyId: 'ABCDEFGHIJ' },
      files: { privateKey: { content: key } },
    },
  })
  const input = {
    channel: 'app_store' as const,
    reference: 'apple-api',
    identifier: 'com.example.ios',
    appId: '123456',
  }
  const result = await checkMerchant(input, store, async (url, init) => {
    assert.equal(new URL(String(url)).searchParams.get('filter[bundleId]'), input.identifier)
    assert.equal(init?.redirect, 'error')
    return Response.json({
      data: [{ id: input.appId, attributes: { bundleId: input.identifier } }],
    })
  })
  assert.equal(result.code, 'verified')
  assert.equal(
    (await checkMerchant(input, store, async () => new Response('', { status: 403 }))).code,
    'rejected',
  )
  await store.saveProfile({
    credentialProfile: 'apple-password',
    platform: 'app_store',
    material: { fields: { appleId: 'synthetic@example.invalid', appPassword: 'synthetic-only' } },
  })
  assert.equal(
    (
      await checkMerchant({ ...input, reference: 'apple-password' }, store, async () => {
        throw new Error('不得访问网络')
      })
    ).code,
    'unsupported_credential_method',
  )
})

class ControlledRunner implements PreflightRunner {
  profiles: ProfileCatalog = {
    code: 'available',
    profiles: [
      {
        reference: 'synthetic-apple',
        channel: 'app_store',
        configured: true,
        revision: 'a'.repeat(64),
      },
    ],
  }
  task: Extract<PreflightTask, { action: 'preflight' }> | null = null
  private finishTask: ((result: PreflightOutcome) => void) | null = null
  async catalog(): Promise<ProfileCatalog> {
    return this.profiles
  }
  check(task: Extract<PreflightTask, { action: 'preflight' }>): Promise<PreflightOutcome> {
    this.task = task
    return new Promise((resolve) => {
      this.finishTask = resolve
    })
  }
  finish(code: PreflightOutcome['code'] = 'verified'): void {
    this.finishTask?.({
      code,
      artifact: 'passed',
      authentication: 'passed',
      target: code === 'verified' ? 'passed' : 'unverified',
    })
  }
  close(): void {
    this.finish('interrupted')
  }
}

async function fixture(t: test.TestContext) {
  const root = await temporary(t, false)
  const projects = new FileProjectStore(join(root, 'projects.json'))
  const applications = new FileApplicationStore(join(root, 'applications.json'))
  const project = await new ProjectCatalog(projects).create('local', {
    name: '合成预检',
    key: 'preflight-test',
    framework: 'native',
  })
  const catalog = new ApplicationCatalog(projects, applications)
  const application = await catalog.create('local', project.id, {
    name: '合成 iOS',
    platform: 'ios',
    identifier: 'com.example.ios',
  })
  const binding = await catalog.bind('local', project.id, application.id, {
    channel: 'app_store',
    appId: '123456',
    credentialReference: 'synthetic-apple',
  })
  const bytes = new FileArtifactStore(join(root, 'artifacts'))
  const artifacts = new ArtifactsService(catalog, bytes, new LocalArtifactInspector())
  const runner = new ControlledRunner()
  const store = new FilePreflightStore(join(root, 'preflights.json'))
  const service = new PreflightsService(catalog, artifacts, bytes, store, runner)
  const app = await createApp(projects, {
    applicationStore: applications,
    artifacts,
    preflights: service,
  })
  t.after(async () => {
    await app.close()
    await rm(root, { recursive: true, force: true })
  })
  const buffer = syntheticIpa()
  await artifacts.receive(
    'local',
    project.id,
    application.id,
    '合成.ipa',
    buffer.length,
    Readable.from(buffer),
  )
  let artifact = (await artifacts.list('local', project.id, application.id))[0]
  for (let i = 0; i < 200 && artifact?.status === 'checking'; i++) {
    await delay(20)
    artifact = (await artifacts.list('local', project.id, application.id))[0]
  }
  assert.ok(artifact?.status === 'ready')
  const input = {
    bindingId: binding.id,
    artifactId: artifact.id,
    expectedBindingRevision: binding.revision,
    expectedProfileRevision: 'a'.repeat(64),
  }
  const url = `/api/projects/${project.id}/applications/${application.id}/preflights`
  return {
    root,
    project,
    application,
    binding,
    artifact,
    input,
    url,
    app,
    service,
    runner,
    catalog,
    bytes,
    store,
  }
}

async function terminal(load: () => Promise<PreflightRecord[]>): Promise<PreflightRecord> {
  for (let i = 0; i < 200; i++) {
    const r = (await load())[0]
    if (r && r.status !== 'running') return r
    await delay(10)
  }
  throw new Error('预检未结束')
}

test('HTTP 预检核对完整归属与版本，202 独立记录、阻止并发、成功可刷新且字节变化失效', async (t) => {
  const f = await fixture(t)
  for (const [input, statusCode] of [
    [{ ...f.input, workspaceId: 'other' }, 400],
    [{ ...f.input, expectedBindingRevision: 9 }, 409],
    [{ ...f.input, expectedProfileRevision: 'b'.repeat(64) }, 409],
    [{ ...f.input, bindingId: randomUUID() }, 404],
    [{ ...f.input, artifactId: randomUUID() }, 404],
  ] as const)
    assert.equal(
      (await f.app.inject({ method: 'POST', url: f.url, payload: input })).statusCode,
      statusCode,
    )
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: f.url.replace(f.project.id, randomUUID()),
        payload: f.input,
      })
    ).statusCode,
    404,
  )
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: f.url,
        payload: f.input,
        headers: { origin: 'https://evil.example' },
      })
    ).statusCode,
    403,
  )
  const response = await f.app.inject({ method: 'POST', url: f.url, payload: f.input })
  assert.equal(response.statusCode, 202, response.body)
  assert.ok(isPreflightRecord(response.json().preflight))
  assert.equal(response.json().preflight.status, 'running')
  assert.equal(
    (await f.app.inject({ method: 'POST', url: f.url, payload: f.input })).statusCode,
    409,
  )
  assert.ok(
    f.runner.task &&
      isPreflightTask({ ...f.runner.task, vaultPath: join(f.root, 'profiles.json') }),
  )
  f.runner.finish()
  const record = await terminal(() => f.store.list('local', f.project.id, f.application.id))
  assert.equal(record.status, 'passed')
  assert.equal(record.uploadPermission, 'not_verified')
  const views = (await f.app.inject({ url: f.url })).json().items
  assert.ok(isPreflightView(views[0]) && views[0].current)
  assert.ok(!JSON.stringify(views).includes(f.root))
  assert.equal(
    (
      await new FilePreflightStore(join(f.root, 'preflights.json')).list(
        'local',
        f.project.id,
        f.application.id,
      )
    )[0]?.status,
    'passed',
  )
  await writeFile(f.bytes.paths(f.artifact).payload, 'changed')
  assert.equal(
    (await f.service.list('local', f.project.id, f.application.id))[0]?.invalidatedBy,
    'artifact_changed',
  )
})

test('Profile 缺失不运行 worker；网络无法验证，绑定、目录与有效期变化独立使历史通过失效', async (t) => {
  const f = await fixture(t)
  f.runner.profiles = { code: 'available', profiles: [] }
  assert.equal(
    (await f.app.inject({ method: 'POST', url: f.url, payload: f.input })).statusCode,
    409,
  )
  assert.equal(f.runner.task, null)
  f.runner.profiles.profiles = [
    {
      reference: 'synthetic-apple',
      channel: 'app_store',
      configured: true,
      revision: 'a'.repeat(64),
    },
  ]
  await f.service.start('local', f.project.id, f.application.id, f.input)
  await delay(0)
  f.runner.finish('network_unavailable')
  const record = await terminal(() => f.store.list('local', f.project.id, f.application.id))
  assert.equal(record.status, 'unverified')
  const passed: PreflightRecord = {
    ...record,
    status: 'passed',
    code: 'verified',
    target: 'passed',
  }
  assert.ok(isPreflightRecord(passed))
  const view = (
    binding = f.binding,
    artifact = f.artifact,
    catalog = f.runner.profiles,
    now = Date.parse(passed.checkedAt ?? ''),
    bytesMatch = true,
  ) => preflightView(passed, binding, artifact, catalog, now, bytesMatch)
  assert.equal(view().current, true)
  assert.equal(view({ ...f.binding, revision: 2 }).invalidatedBy, 'binding_changed')
  assert.equal(
    view(f.binding, { ...f.artifact, sha256: 'c'.repeat(64) }).invalidatedBy,
    'artifact_changed',
  )
  assert.equal(
    view(f.binding, f.artifact, {
      code: 'available',
      profiles: [
        {
          reference: 'synthetic-apple',
          channel: 'app_store',
          configured: true,
          revision: 'b'.repeat(64),
        },
      ],
    }).invalidatedBy,
    'profile_changed',
  )
  assert.equal(
    view(f.binding, f.artifact, { code: 'storage_unavailable', profiles: [] }).invalidatedBy,
    'profile_unavailable',
  )
  assert.equal(
    view(f.binding, f.artifact, f.runner.profiles, Date.parse(passed.expiresAt ?? ''))
      .invalidatedBy,
    'expired',
  )
  assert.equal(
    view(f.binding, f.artifact, f.runner.profiles, Date.now(), false).invalidatedBy,
    'artifact_changed',
  )
  assert.ok(!isPreflightRecord({ ...passed, authentication: 'unverified' }))
  assert.throws(() => validatePreflightInput({ ...f.input, secret: 'synthetic' }))
})

test('重启把 running 恢复为无法验证，末态不可覆盖；损坏存储拒绝覆盖', async (t) => {
  const f = await fixture(t)
  const running = await f.service.start('local', f.project.id, f.application.id, f.input)
  const file = join(f.root, 'preflights.json')
  // 用另一份隔离文件模拟崩溃磁盘快照，避免两个实例写同一存储。
  const recoveryFile = join(f.root, 'recovery.json')
  await writeFile(recoveryFile, await readFile(file))
  const recovery = new FilePreflightStore(recoveryFile)
  await recovery.initialize()
  const recovered = (await recovery.list('local', f.project.id, f.application.id))[0]
  assert.equal(recovered?.status, 'unverified')
  assert.equal(recovered?.code, 'interrupted')
  assert.ok(recovered)
  await assert.rejects(recovery.save({ ...recovered, code: 'runner_unavailable' }))
  await writeFile(recoveryFile, '{broken')
  await assert.rejects(recovery.save({ ...running, id: randomUUID() }))
  assert.equal(await readFile(recoveryFile, 'utf8'), '{broken')
})

test('真实目录子进程只读隔离目录；缺失档案不解析秘密，私有协议拒绝跨平台及写动作', async (t) => {
  const root = await temporary(t)
  const runner = new LocalPreflightRunner(join(root, 'credentials', 'profiles.json'))
  t.after(() => runner.close())
  const catalog = await runner.catalog()
  assert.ok(['available', 'unsupported_environment'].includes(catalog.code))
  assert.deepEqual(catalog.profiles, [])
  const nonce = 'a'.repeat(32)
  const task: Extract<PreflightTask, { action: 'preflight' }> = {
    schemaVersion: 1,
    action: 'preflight',
    nonce,
    vaultPath: join(root, 'credentials', 'profiles.json'),
    channel: 'app_store',
    appId: '123456',
    reference: 'missing',
    profileRevision: 'a'.repeat(64),
    inspection: {
      schemaVersion: 1,
      action: 'inspect',
      nonce,
      artifactId: randomUUID(),
      storageRoot: root,
      format: 'ipa',
      sizeBytes: 42,
      sha256: 'a'.repeat(64),
      target: {
        workspaceId: 'local',
        projectId: 'project',
        applicationId: 'app',
        platform: 'ios',
        identifier: 'com.example.ios',
      },
    },
  }
  assert.ok(isPreflightTask(task))
  assert.ok(!isPreflightTask({ ...task, channel: 'huawei' }))
  assert.ok(!isPreflightTask({ ...task, action: 'upload' }))
  assert.ok(!isPreflightTask({ ...task, secret: 'injected' }))
  assert.equal((await checkPreflight(task)).code, 'credentials_unavailable')
  assert.equal((await runner.check(task)).code, 'credentials_unavailable')
})
