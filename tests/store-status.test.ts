/** @description 独立官方状态查询回归；没有本地计划也可查询，所有网络均注入合成响应。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ApplicationCatalog, ProjectCatalog } from '../packages/domain/src/index.ts'
import { FileProjectStore } from '../apps/api/src/project-store.ts'
import { FileApplicationStore } from '../apps/api/src/application-store.ts'
import { StoreStatusService } from '../apps/api/src/store-status.service.ts'
import { StoreStatusStore } from '../apps/api/src/store-status-store.ts'
import { createApp } from '../apps/api/src/app.ts'
import { LocalStoreStatusRunner } from '../packages/runner-local/src/store-status-runner.ts'
import {
  isStoreStatusResponse,
  isStoreStatusSnapshot,
  type StoreStatusSnapshot,
  type StoreStatusJob,
  type BindingChannel,
} from '../packages/contracts/src/index.ts'
import { queryStoreStatus } from '../packages/provider-app-ship/src/store-status.ts'
import {
  credentialStore,
  validateCredentialSubmission,
} from '../packages/provider-app-ship/src/index.ts'
import { MemoryCredentialSecrets } from './fixtures/credential-intake.ts'
import { storeCredentials, honorApp } from './fixtures/store-updates.ts'
import { vivoCredentials, vivoApp } from './fixtures/vivo.ts'

async function fixture(t: test.TestContext, channel: BindingChannel = 'meizu') {
  const root = await mkdtemp(join(tmpdir(), 'harbor-store-status-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const projects = new FileProjectStore(join(root, 'projects.json'))
  const project = await new ProjectCatalog(projects).create('local', {
    key: 'query',
    name: '查询测试',
    framework: 'native',
  })
  const applications = new FileApplicationStore(join(root, 'applications.json'))
  const catalog = new ApplicationCatalog(projects, applications)
  const application = await catalog.create('local', project.id, {
    name: '官网已提交应用',
    identifier: 'com.example.query',
    platform: channel === 'app_store' ? 'ios' : channel === 'harmony' ? 'harmony' : 'android',
  })
  const binding = await catalog.bind('local', project.id, application.id, {
    channel,
    appId: ['xiaomi', 'oppo', 'vivo'].includes(channel) ? application.identifier : '123456',
    credentialReference: 'synthetic-query-account',
  })
  const snapshot: StoreStatusSnapshot = {
    bindingId: binding.id,
    channel,
    checkedAt: new Date().toISOString(),
    code: 'observed',
    versions: [
      { versionId: '200', versionName: '2.0', buildNumber: null, state: 'in_review', rawState: 20 },
    ],
  }
  const cache = new StoreStatusStore(join(root, 'status.json'))
  return { root, projects, project, applications, catalog, application, binding, snapshot, cache }
}

test('真实隔离 worker 可启动，缺本机材料只返回固定失败且关闭后不再启动查询', async (t) => {
  const f = await fixture(t)
  // 临时空目录不会触及用户 Vault 或商店；同时验证生产 worker 的包入口和 IPC 回报。
  const runner = new LocalStoreStatusRunner(join(f.root, 'credentials', 'profiles.json'))
  t.after(() => runner.close())
  const job = { binding: f.binding, identifier: f.application.identifier }
  const result = await runner.run(job)
  assert.equal(result.code, 'authentication')
  assert.equal(result.bindingId, f.binding.id)
  assert.deepEqual(result.versions, [])
  runner.close()
  assert.equal((await runner.run(job)).code, 'network')
})

test('没有本地计划仍可列出绑定与查询；归属、来源、覆盖字段和错目标均拒绝', async (t) => {
  const f = await fixture(t)
  let calls = 0,
    closed = false
  const service = new StoreStatusService(
    f.projects,
    f.catalog,
    f.cache,
    {
      async run() {
        calls++
        return f.snapshot
      },
      close() {
        closed = true
      },
    },
    ['http://127.0.0.1:5178'],
  )
  const api = await createApp(f.projects, {
    applicationStore: f.applications,
    storeStatus: service,
  })
  t.after(() => api.close())
  const url = `/api/store-status/${f.project.id}/${f.application.id}/${f.binding.id}/query`
  const headers = {
    host: '127.0.0.1',
    origin: 'http://127.0.0.1:5178',
    'x-release-harbor-query': '1',
  }
  const before = await readFile(join(f.root, 'applications.json'), 'utf8')
  const mtime = (await stat(join(f.root, 'applications.json'))).mtimeMs
  const get = await api.inject({ url: '/api/store-status', headers })
  assert.equal(get.statusCode, 200)
  assert.ok(isStoreStatusResponse(get.json()))
  assert.equal(get.json().targets.length, 1)
  assert.equal(get.json().snapshots.length, 0)
  assert.equal(calls, 0)
  assert.equal(JSON.stringify(get.json()).includes('credentialReference'), false)
  for (const [h, payload, target, code] of [
    [{ host: '127.0.0.1' }, {}, url, 403],
    [headers, { appId: 'override' }, url, 400],
    [headers, {}, url.replace(f.project.id, randomUUID()), 404],
  ] as const) {
    const result = await api.inject({ method: 'POST', url: target, headers: h, payload })
    assert.equal(result.statusCode, code)
  }
  assert.equal(calls, 0)
  const result = await api.inject({ method: 'POST', url, headers, payload: {} })
  assert.equal(result.statusCode, 201)
  assert.deepEqual(result.json().snapshot, f.snapshot)
  await api.inject({ url: '/api/store-status', headers })
  assert.equal(calls, 1)
  assert.equal((await api.inject({ method: 'POST', url, headers, payload: {} })).statusCode, 409)
  assert.equal(await readFile(join(f.root, 'applications.json'), 'utf8'), before)
  assert.equal((await stat(join(f.root, 'applications.json'))).mtimeMs, mtime)
  await assert.rejects(readFile(join(f.root, 'release-plans.json')), { code: 'ENOENT' })
  await api.close()
  assert.equal(closed, true)
})

test('查询预约跨重启生效，失败保留成功，缓存指纹隔离与损坏保护', async (t) => {
  const f = await fixture(t),
    key = 'a'.repeat(64),
    time = Date.now()
  await f.cache.reserve(key, time)
  const reopened = new StoreStatusStore(join(f.root, 'status.json'))
  await assert.rejects(reopened.reserve(key, time + 1000), /正在查询/)
  await f.cache.finish(key, f.snapshot)
  await f.cache.reserve(key, time + 11000)
  const failure = { ...f.snapshot, code: 'network' as const, versions: [] }
  await f.cache.finish(key, failure)
  assert.deepEqual(await reopened.list([key]), [failure, f.snapshot])
  assert.deepEqual(await reopened.list(['b'.repeat(64)]), [])
  await writeFile(join(f.root, 'status.json'), '{broken')
  await assert.rejects(reopened.reserve(key), /无法读取/)
  assert.equal(await readFile(join(f.root, 'status.json'), 'utf8'), '{broken')
})

test('同绑定并发查询只有一次；改绑期间的旧结果不会归入新目标', async (t) => {
  const f = await fixture(t)
  let resolve: (value: StoreStatusSnapshot) => void = () => {}
  let started: () => void = () => {}
  const ready = new Promise<void>((r) => {
    started = r
  })
  const service = new StoreStatusService(f.projects, f.catalog, f.cache, {
    run() {
      started()
      return new Promise((r) => {
        resolve = r
      })
    },
    close() {},
  })
  const query = service.query(f.project.id, f.application.id, f.binding.id)
  await ready
  await assert.rejects(service.query(f.project.id, f.application.id, f.binding.id), /正在查询/)
  await f.catalog.updateBinding('local', f.project.id, f.application.id, f.binding.id, {
    appId: '999999',
    credentialReference: f.binding.credentialReference,
    expectedRevision: 1,
  })
  resolve(f.snapshot)
  await assert.rejects(query, /已变化/)
  assert.deepEqual((await service.list()).snapshots, [])
})

test('所有渠道独立显示并可查询，错误目标回报不会进入成功缓存', async (t) => {
  for (const channel of [
    'huawei',
    'xiaomi',
    'oppo',
    'vivo',
    'meizu',
    'honor',
    'tencent',
    'harmony',
    'app_store',
  ] as const) {
    const f = await fixture(t, channel)
    let calls = 0
    const service = new StoreStatusService(f.projects, f.catalog, f.cache, {
      async run() {
        calls++
        return { ...f.snapshot, bindingId: randomUUID() }
      },
      close() {},
    })
    const response = await service.list()
    assert.ok(isStoreStatusResponse(response))
    assert.equal(response.targets[0]?.channel, channel)
    assert.equal(response.targets[0]?.querySupported, true)
    const result = await service.query(f.project.id, f.application.id, f.binding.id)
    assert.equal(result.code, 'invalid_response')
    assert.equal(calls, 1)
  }
})

for (const channel of ['meizu', 'honor', 'vivo'] as const) {
  test(`${channel} 只读官方接口按商店身份返回版本，拒绝错包且不泄漏原始资料`, async (t) => {
    const f = await fixture(t, channel)
    const credentials = credentialStore(
      join(f.root, 'profiles.json'),
      new MemoryCredentialSecrets(),
    )
    await credentials.saveProfile({
      credentialProfile: f.binding.credentialReference,
      platform: channel,
      material: validateCredentialSubmission(channel, {
        displayName: '合成查询',
        credentials: channel === 'vivo' ? vivoCredentials : storeCredentials,
      }).material,
    })
    const job: StoreStatusJob = { binding: f.binding, identifier: f.application.identifier }
    let mismatch = false,
      emptyRelease = false
    const calls: string[] = []
    const transport: typeof fetch = async (url, init) => {
      const path = new URL(String(url)).pathname
      calls.push(path)
      const pkg = mismatch ? 'com.wrong' : job.identifier
      const json = (value: unknown) => new Response(JSON.stringify(value))
      if (channel === 'vivo') {
        assert.equal(new URLSearchParams(String(init?.body)).get('method'), 'app.query.details')
        return json({ code: 0, data: { ...vivoApp(pkg), status: 2 } })
      }
      if (path.endsWith('/token'))
        return channel === 'meizu'
          ? json({ code: 200, value: { accessToken: 'synthetic-token' } })
          : json({ access_token: 'synthetic-token' })
      assert.equal(init?.method ?? 'GET', 'GET')
      if (channel === 'meizu') {
        assert.ok(path.endsWith('/app/versions'))
        return json({
          code: 200,
          value: [
            {
              id: 123456,
              pkgName: pkg,
              verId: 200,
              versionName: '2.0',
              status: 20,
              private: 'must-not-leak',
            },
          ],
        })
      }
      if (path.endsWith('get-app-id'))
        return json({ code: 0, data: [{ appId: 123456, packageName: pkg }] })
      if (path.endsWith('get-app-current-release'))
        return json({
          code: 0,
          data: { releaseId: '200', versionName: '1.0.0', versionCode: 6, auditResult: 1 },
        })
      assert.ok(path.endsWith('get-app-detail'))
      return json({
        code: 0,
        data: { ...honorApp(pkg), ...(emptyRelease ? { releaseInfo: {} } : {}) },
      })
    }
    const result = await queryStoreStatus(job, credentials, transport)
    assert.equal(result.code, 'observed')
    assert.ok(isStoreStatusSnapshot(result))
    assert.equal(result.versions[0]?.state, channel === 'honor' ? 'published' : 'in_review')
    if (channel === 'vivo') assert.equal(result.versions[0]?.versionName, null)
    assert.equal(JSON.stringify(result).includes('private'), false)
    if (channel === 'honor') {
      // 空在架资料不能制造“已上架”证据，当前审核通过仍单独保留。
      emptyRelease = true
      const withoutRelease = await queryStoreStatus(job, credentials, transport)
      assert.equal(withoutRelease.versions.length, 1)
      assert.equal(withoutRelease.versions[0]?.state, 'approved')
    }
    mismatch = true
    assert.equal((await queryStoreStatus(job, credentials, transport)).code, 'invalid_response')
    assert.ok(!calls.some((path) => /upload|publish$|submit-audit/.test(path)))
  })
}

for (const channel of ['oppo', 'tencent', 'harmony'] as const) {
  test(`${channel} 官方版本资料独立读取，不将未核实字典或旧在架状态当审核结论`, async (t) => {
    const f = await fixture(t, channel)
    const { oppoCredentials } = await import('./fixtures/oppo.ts')
    const { tencentCredentials, harmonyCredentials } = await import('./fixtures/tencent-harmony.ts')
    const store = credentialStore(join(f.root, 'profiles.json'), new MemoryCredentialSecrets())
    await store.saveProfile({
      credentialProfile: f.binding.credentialReference,
      platform: channel,
      material: validateCredentialSubmission(channel, {
        displayName: '合成资料',
        credentials:
          channel === 'oppo'
            ? oppoCredentials
            : channel === 'tencent'
              ? tencentCredentials
              : harmonyCredentials,
      }).material,
    })
    const paths: string[] = []
    const transport: typeof fetch = async (raw, init) => {
      const url = new URL(String(raw)),
        path = url.pathname
      paths.push(path)
      const json = (value: unknown) => new Response(JSON.stringify(value))
      if (channel === 'oppo') {
        if (path.endsWith('/token'))
          return json({ errno: 0, data: { access_token: 'synthetic-token' } })
        assert.equal(path, '/resource/v1/app/info')
        assert.equal(init?.method ?? 'GET', 'GET')
        assert.equal(url.searchParams.get('pkg_name'), f.application.identifier)
        return json({
          errno: 0,
          data: {
            pkg_name: f.application.identifier,
            type: 7,
            version_name: '2.0',
            version_code: 7,
            audit_status: 1,
            audit_status_name: '不可据此猜测',
            state: 1,
          },
        })
      }
      if (channel === 'tencent') {
        if (path.endsWith('/query_app_update_status')) return json({ ret: 0, audit_status: 1 })
        assert.ok(path.endsWith('/query_app_detail'))
        return json({
          ret: 0,
          pkg_name: f.application.identifier,
          app_id: f.binding.appId,
          app_type: 1,
          VersionName: '2.0',
          VersionCode: 7,
        })
      }
      if (path.endsWith('/token')) return json({ access_token: 'synthetic-token' })
      assert.equal(init?.method, 'GET')
      if (path.endsWith('/appid-list'))
        return json({ ret: { code: 0 }, appids: [{ value: f.binding.appId }] })
      assert.ok(path.endsWith('/app-info'))
      return json({
        ret: { code: 0 },
        appInfo: { versionNumber: '2.0', versionCode: 7, releaseState: 0 },
      })
    }
    const result = await queryStoreStatus(
      { binding: f.binding, identifier: f.application.identifier },
      store,
      transport,
    )
    assert.equal(result.code, 'observed')
    assert.ok(isStoreStatusSnapshot(result))
    assert.equal(
      result.versions[0]?.state,
      channel === 'harmony' ? 'published' : channel === 'tencent' ? 'in_review' : 'unknown',
    )
    assert.ok(!paths.some((path) => /upload|update_app|app-submit/.test(path)))
  })
}

test('Apple 官网审核版本无需本机操作，独立读取且只请求 GET', async (t) => {
  const f = await fixture(t, 'app_store')
  const { generateKeyPairSync } = await import('node:crypto')
  const { appleReviewNetwork } = await import('./fixtures/apple-review.ts')
  const store = credentialStore(join(f.root, 'profiles.json'), new MemoryCredentialSecrets())
  const privateKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    .privateKey.export({ format: 'pem', type: 'pkcs8' })
    .toString()
  await store.saveProfile({
    credentialProfile: f.binding.credentialReference,
    platform: 'app_store',
    material: {
      fields: { apiKeyId: 'ABC123DE45', apiIssuerId: '11111111-1111-4111-8111-111111111111' },
      files: { privateKey: { content: privateKey } },
    },
  })
  const n = appleReviewNetwork(f.binding, f.application.identifier)
  n.options.state = 'IN_REVIEW'
  n.options.next = true
  const result = await queryStoreStatus(
    { binding: f.binding, identifier: f.application.identifier },
    store,
    n.transport,
  )
  assert.equal(result.code, 'observed')
  assert.equal(result.versions[0]?.state, 'in_review')
  assert.equal(result.versions[0]?.buildNumber, '42')
  assert.ok(n.calls.every((call) => call.method === 'GET'))
  assert.ok(!n.calls.some((call) => call.path.includes('/builds')))
  for (const [key, value, expected] of [
    ['versionsNext', true, 'invalid_response'],
    ['foreignBuild', true, 'invalid_response'],
    ['failPath', `/v1/apps/${f.binding.appId}/appStoreVersions`, 'request_rejected'],
  ] as const) {
    Object.assign(n.options, { [key]: value })
    assert.equal(
      (
        await queryStoreStatus(
          { binding: f.binding, identifier: f.application.identifier },
          store,
          n.transport,
        )
      ).code,
      expected,
    )
    Object.assign(n.options, { [key]: key === 'failPath' ? '' : false })
  }
  n.options.state = 'REPLACED_WITH_NEW_VERSION'
  assert.equal(
    (
      await queryStoreStatus(
        { binding: f.binding, identifier: f.application.identifier },
        store,
        n.transport,
      )
    ).versions[0]?.state,
    'superseded',
  )
  n.options.foreign = true
  assert.notEqual(
    (
      await queryStoreStatus(
        { binding: f.binding, identifier: f.application.identifier },
        store,
        n.transport,
      )
    ).code,
    'observed',
  )
})
