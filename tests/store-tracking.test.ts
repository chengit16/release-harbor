/** @description 精确版本与人工核对回归；隔离文件和合成网络保护来源、缓存、幂等及发布零副作用。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ApplicationCatalog, ProjectCatalog } from '../packages/domain/src/index.ts'
import { FileProjectStore } from '../apps/api/src/project-store.ts'
import { FileApplicationStore } from '../apps/api/src/application-store.ts'
import { StoreStatusService } from '../apps/api/src/store-status.service.ts'
import { StoreStatusStore } from '../apps/api/src/store-status-store.ts'
import { createApp } from '../apps/api/src/app.ts'
import {
  isStoreStatusResponse,
  isStoreVersionQuery,
  isStoreManualInput,
  type StoreStatusSnapshot,
  type StoreStatusTarget,
  type StoreManualRecord,
} from '../packages/contracts/src/index.ts'
import { storeTodos, latestManualRecords } from '../apps/web/src/pages/reviewTracking/storeTodos.ts'
import { queryStoreStatus } from '../packages/provider-app-ship/src/store-status.ts'
import {
  credentialStore,
  validateCredentialSubmission,
} from '../packages/provider-app-ship/src/index.ts'
import { MemoryCredentialSecrets } from './fixtures/credential-intake.ts'
import { oppoCredentials } from './fixtures/oppo.ts'

async function fixture(t: test.TestContext, channel: 'oppo' | 'xiaomi' = 'oppo') {
  const root = await mkdtemp(join(tmpdir(), 'harbor-tracking-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const projects = new FileProjectStore(join(root, 'projects.json'))
  const project = await new ProjectCatalog(projects).create('local', {
    name: '跟踪测试',
    key: 'tracking',
    framework: 'native',
  })
  const applications = new FileApplicationStore(join(root, 'applications.json'))
  const catalog = new ApplicationCatalog(projects, applications)
  const application = await catalog.create('local', project.id, {
    name: '官网提交',
    identifier: 'com.example.tracking',
    platform: 'android',
  })
  const binding = await catalog.bind('local', project.id, application.id, {
    channel,
    appId: application.identifier,
    credentialReference: 'synthetic-tracking',
  })
  const cacheFile = join(root, 'status.json'),
    cache = new StoreStatusStore(cacheFile)
  const args: [string, string, string] = [project.id, application.id, binding.id]
  return { root, projects, applications, catalog, application, binding, cache, cacheFile, args }
}
const query = { kind: 'oppo_build' as const, buildNumber: '42' }
const checkedAt = '2026-01-01T00:00:00.000Z'
function version(state: 'rejected' | 'published' | 'pending_manual_release' = 'rejected') {
  return { versionId: null, versionName: '2.0', buildNumber: '42', state, rawState: null }
}

test('指定构建不覆盖默认缓存，失败保留成功，schema1读取零写入且损坏拒绝覆盖', async (t) => {
  const f = await fixture(t),
    key = 'a'.repeat(64),
    time = Date.now()
  const snapshot: StoreStatusSnapshot = {
    bindingId: f.binding.id,
    channel: 'oppo',
    checkedAt,
    code: 'observed',
    versions: [version()],
  }
  await writeFile(
    f.cacheFile,
    JSON.stringify({
      schemaVersion: 1,
      entries: [{ key, requestedAt: 0, pending: false, snapshots: [snapshot] }],
    }),
  )
  const original = await readFile(f.cacheFile, 'utf8')
  assert.deepEqual((await f.cache.tracking([key])).trackedSnapshots, [])
  assert.equal(await readFile(f.cacheFile, 'utf8'), original)
  await f.cache.reserve(key, time)
  const tracked = { ...snapshot, query }
  await f.cache.finish(key, tracked)
  await f.cache.reserve(key, time + 11000)
  const failure = { ...tracked, code: 'network' as const, versions: [] }
  await f.cache.finish(key, failure)
  const result = await new StoreStatusStore(f.cacheFile).tracking([key])
  assert.deepEqual(result.snapshots, [snapshot])
  assert.deepEqual(result.trackedSnapshots, [failure, tracked])
  assert.deepEqual(await f.cache.tracking(['b'.repeat(64)]), {
    snapshots: [],
    trackedSnapshots: [],
    manualRecords: [],
    queryHistory: [],
    materialSnapshots: [],
  })
  const disk = JSON.parse(await readFile(f.cacheFile, 'utf8'))
  assert.equal(disk.schemaVersion, 4)
  disk.entries[0].trackedSnapshots[1].versions[0].buildNumber = '99'
  await writeFile(f.cacheFile, JSON.stringify(disk))
  await assert.rejects(f.cache.reserve(key, time + 22000), /无法读取/)
  assert.equal(await readFile(f.cacheFile, 'utf8'), JSON.stringify(disk))
})

test('指定构建API只接受OPPO定位，校验回报构建并保护默认目录与无计划查询', async (t) => {
  const f = await fixture(t)
  let calls = 0
  const service = new StoreStatusService(
    f.projects,
    f.catalog,
    f.cache,
    {
      async run(job) {
        calls++
        assert.deepEqual(job.query, query)
        // 合成平台忽略定位参数，不能被挂到构建42下。
        return {
          bindingId: f.binding.id,
          channel: 'oppo',
          checkedAt,
          code: 'observed',
          query,
          versions: [{ ...version(), buildNumber: '43' }],
        }
      },
      close() {},
    },
    ['http://127.0.0.1:5178'],
  )
  const api = await createApp(f.projects, {
    applicationStore: f.applications,
    storeStatus: service,
  })
  t.after(() => api.close())
  const url = `/api/store-status/${f.args.join('/')}/query`
  const headers = {
    host: '127.0.0.1',
    origin: 'http://127.0.0.1:5178',
    'x-release-harbor-query': '1',
  }
  for (const payload of [{ query: { ...query, buildNumber: '042' } }, { query, appId: 'other' }])
    assert.equal((await api.inject({ method: 'POST', url, headers, payload })).statusCode, 400)
  assert.equal(calls, 0)
  const result = await api.inject({ method: 'POST', url, headers, payload: { query } })
  assert.equal(result.statusCode, 201)
  assert.equal(result.json().snapshot.code, 'invalid_response')
  const response = await service.list()
  assert.ok(isStoreStatusResponse(response))
  assert.equal(response.snapshots.length, 0)
  assert.equal(response.trackedSnapshots?.length, 1)
  assert.equal(response.queryHistory?.length, 1)
  assert.equal(response.queryHistory?.[0]?.code, 'invalid_response')
  assert.equal((await service.list()).queryHistory?.length, 1)
  assert.equal(calls, 1)
  await assert.rejects(readFile(join(f.root, 'release-plans.json')), { code: 'ENOENT' })
  await f.catalog.updateBinding('local', ...f.args, {
    appId: f.binding.appId,
    credentialReference: 'another-synthetic-history',
    expectedRevision: 1,
  })
  assert.deepEqual((await service.list()).queryHistory, [])
  assert.equal(calls, 1)
  const xiaomi = await fixture(t, 'xiaomi')
  const other = new StoreStatusService(xiaomi.projects, xiaomi.catalog, xiaomi.cache, {
    async run() {
      throw Error('不得调用')
    },
    close() {},
  })
  await assert.rejects(other.query(...xiaomi.args, query), /只有 OPPO/)
  assert.equal(isStoreVersionQuery({ ...query, buildNumber: '1e2' }), false)
})

test('人工核对限定小米，来源不可伪造；幂等重试、并发追加、改绑隔离且不影响官方与发布事实', async (t) => {
  const f = await fixture(t, 'xiaomi')
  let calls = 0
  const service = new StoreStatusService(
    f.projects,
    f.catalog,
    f.cache,
    {
      async run() {
        calls++
        throw Error()
      },
      close() {},
    },
    ['http://127.0.0.1:5178'],
  )
  const api = await createApp(f.projects, {
    applicationStore: f.applications,
    storeStatus: service,
  })
  t.after(() => api.close())
  const input = {
    requestId: randomUUID(),
    versionName: '2.0',
    buildNumber: '42',
    state: 'rejected',
    checkedAt,
    note: '在官方后台核对后记录',
  }
  const url = `/api/store-status/${f.args.join('/')}/manual`
  const headers = {
    host: '127.0.0.1',
    origin: 'http://127.0.0.1:5178',
    'x-release-harbor-query': '1',
  }
  assert.equal((await api.inject({ method: 'POST', url, payload: input })).statusCode, 403)
  for (const payload of [
    { ...input, source: 'official' },
    { ...input, checkedAt: '2099-01-01T00:00:00.000Z' },
    { ...input, note: 'a\nb' },
  ])
    assert.equal((await api.inject({ method: 'POST', url, headers, payload })).statusCode, 400)
  assert.equal(
    (
      await api.inject({
        method: 'POST',
        url: url.replace(f.args[0], randomUUID()),
        headers,
        payload: input,
      })
    ).statusCode,
    404,
  )
  const original = await readFile(join(f.root, 'applications.json'), 'utf8')
  const saved = await service.saveManual(...f.args, input)
  assert.equal(saved.source, 'local_user')
  assert.deepEqual(await service.saveManual(...f.args, input), saved)
  await assert.rejects(
    service.saveManual(...f.args, { ...input, state: 'published' }),
    /请求已使用/,
  )
  await Promise.all(
    [1, 2].map(() => service.saveManual(...f.args, { ...input, requestId: randomUUID() })),
  )
  const response = await service.list()
  assert.ok(isStoreStatusResponse(response))
  assert.equal(response.manualRecords?.length, 3)
  assert.deepEqual(response.snapshots, [])
  assert.equal(calls, 0)
  assert.equal(await readFile(join(f.root, 'applications.json'), 'utf8'), original)
  await assert.rejects(readFile(join(f.root, 'release-plans.json')), { code: 'ENOENT' })
  await f.catalog.updateBinding('local', f.args[0], f.args[1], f.args[2], {
    appId: f.binding.appId,
    credentialReference: 'another-synthetic',
    expectedRevision: 1,
  })
  assert.deepEqual((await service.list()).manualRecords, [])
  assert.equal(isStoreManualInput({ ...input, versionName: '' }), false)
})

test('OPPO provider发送固定version_code，仅匹配构建成功，未知码和错包不造结论', async (t) => {
  const f = await fixture(t)
  const store = credentialStore(join(f.root, 'profiles.json'), new MemoryCredentialSecrets())
  await store.saveProfile({
    credentialProfile: f.binding.credentialReference,
    platform: 'oppo',
    material: validateCredentialSubmission('oppo', {
      displayName: '合成账号',
      credentials: oppoCredentials,
    }).material,
  })
  let build = '42'
  const paths: string[] = []
  const transport: typeof fetch = async (raw, init) => {
    const url = new URL(String(raw))
    paths.push(url.pathname)
    if (url.pathname.endsWith('/token'))
      return Response.json({ errno: 0, data: { access_token: 'synthetic-tracking-token' } })
    assert.equal(url.pathname, '/resource/v1/app/info')
    assert.equal(init?.method, 'GET')
    assert.equal(url.searchParams.get('version_code'), '42')
    return Response.json({
      errno: 0,
      data: {
        pkg_name: f.application.identifier,
        type: 7,
        version_name: '2.0',
        version_code: build,
        audit_status: '3',
      },
    })
  }
  const job = { binding: f.binding, identifier: f.application.identifier, query }
  const result = await queryStoreStatus(job, store, transport)
  assert.equal(result.code, 'observed')
  assert.deepEqual(result.query, query)
  assert.equal(result.versions[0]?.state, 'rejected')
  build = '43'
  assert.equal((await queryStoreStatus(job, store, transport)).code, 'invalid_response')
  assert.ok(paths.every((p) => /token$|\/app\/info$/.test(p)))
})

test('待办保留来源时间，不借失败前成功产生可发布动作，人工记录按实际核对时间取最新', () => {
  const bindingId = randomUUID()
  const target: StoreStatusTarget = {
    bindingId,
    projectId: randomUUID(),
    projectName: '项目',
    applicationId: randomUUID(),
    applicationName: '应用',
    platform: 'ios',
    identifier: 'com.example.todo',
    channel: 'app_store',
    appId: '123456',
    querySupported: true,
    queryNotice: null,
  }
  const snapshot: StoreStatusSnapshot = {
    bindingId,
    channel: 'app_store',
    checkedAt,
    code: 'observed',
    versions: [version('pending_manual_release')],
  }
  assert.equal(storeTodos([target], [snapshot], [], [])[0]?.kind, 'manual_release')
  const failure: StoreStatusSnapshot = {
    ...snapshot,
    checkedAt: '2026-01-02T00:00:00.000Z',
    code: 'network',
    versions: [],
  }
  assert.deepEqual(
    storeTodos([target], [failure, snapshot], [], []).map((i) => i.kind),
    ['query_failed'],
  )
  const oppo = { ...target, platform: 'android' as const, channel: 'oppo' as const }
  const tracked: StoreStatusSnapshot = { ...failure, channel: 'oppo', query }
  assert.deepEqual(
    storeTodos([oppo], [{ ...snapshot, channel: 'oppo' }], [tracked], []).map((i) => i.kind),
    ['query_failed'],
  )
  const xiaomi = { ...oppo, channel: 'xiaomi' as const }
  assert.equal(storeTodos([xiaomi], [], [], [])[0]?.source, 'capability')
  const manual: StoreManualRecord = {
    requestId: randomUUID(),
    bindingId,
    versionName: '2.0',
    buildNumber: '42',
    state: 'rejected',
    checkedAt: '2026-01-02T00:00:00.000Z',
    createdAt: '2026-01-03T00:00:00.000Z',
    source: 'local_user',
    note: '',
  }
  const older = {
    ...manual,
    requestId: randomUUID(),
    state: 'published' as const,
    checkedAt,
    createdAt: '2026-01-04T00:00:00.000Z',
  }
  assert.deepEqual(latestManualRecords([older, manual]), [manual])
  assert.equal(storeTodos([xiaomi], [], [], [older, manual])[0]?.source, 'manual')
  assert.equal(storeTodos([xiaomi], [], [], [older, manual])[0]?.checkedAt, manual.checkedAt)
})
