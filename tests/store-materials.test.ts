/** @description 指定版本资料检查回归；合成账号与网络验证只读、私人字段不出边界、独立缓存及错误保护。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  isStoreStatusJob,
  isStoreStatusSnapshot,
  isStoreStatusResponse,
  isStoreMaterialReport,
  type ChannelBinding,
  type StoreStatusSnapshot,
  type StoreMaterialReport,
  type StoreStatusTarget,
} from '../packages/contracts/src/index.ts'
import { ApplicationCatalog, ProjectCatalog } from '../packages/domain/src/index.ts'
import { FileProjectStore } from '../apps/api/src/project-store.ts'
import { FileApplicationStore } from '../apps/api/src/application-store.ts'
import { StoreStatusStore } from '../apps/api/src/store-status-store.ts'
import { StoreStatusService } from '../apps/api/src/store-status.service.ts'
import { createApp } from '../apps/api/src/app.ts'
import { appleReviewTestClient } from './fixtures/apple-review.ts'
import { inspectAppleStoreMaterials } from '../packages/provider-app-ship/src/apple-store-materials.ts'
import { queryStoreStatus } from '../packages/provider-app-ship/src/store-status.ts'
import type { AppleReviewClient } from '../packages/provider-app-ship/src/apple-review-client.ts'
import { storeTodos } from '../apps/web/src/pages/reviewTracking/storeTodos.ts'
import {
  materialImages,
  materialReport,
  materialText,
  rejectionSummary,
} from '../packages/provider-app-ship/src/store-material-projection.ts'

const identifier = 'com.example.materials'
const binding: ChannelBinding = {
  id: randomUUID(),
  workspaceId: 'local',
  projectId: randomUUID(),
  verification: 'not_checked',
  applicationId: randomUUID(),
  channel: 'app_store',
  appId: '123456',
  credentialReference: 'synthetic-materials',
  revision: 1,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
}
const materials: StoreMaterialReport = {
  checks: {
    build: 'present',
    description: 'present',
    support_url: 'present',
    screenshots: 'missing',
    review_contact: 'missing',
    demo_access: 'not_required',
    privacy: 'unchecked',
    compliance: 'unchecked',
  },
}
const snapshot: StoreStatusSnapshot = {
  bindingId: binding.id,
  channel: 'app_store',
  checkedAt: '2026-11-07T00:00:00.000Z',
  materialVersionId: 'V1',
  materials,
  code: 'observed',
  versions: [
    { versionId: 'V1', versionName: '1.2.3', buildNumber: '42', state: 'rejected', rawState: null },
  ],
}
async function directory(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'harbor-materials-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

test('Apple检查先核对应用与版本，仅GET并投影完整性，不泄漏联系人、密码、网址或审核正文', async (t) => {
  const root = await directory(t)
  const network = await appleReviewTestClient(join(root, 'profiles.json'), binding, identifier)
  const job = { binding, identifier, materialVersionId: 'V1' }
  const result = await queryStoreStatus(job, network.store, network.transport)
  assert.ok(isStoreStatusSnapshot(result))
  assert.equal(result.code, 'observed')
  assert.equal(result.materials?.checks.review_contact, 'present')
  assert.equal(result.materials?.checks.screenshots, 'present')
  assert.equal(result.materials?.checks.demo_access, 'present')
  assert.equal(result.materials?.extraChecks?.privacy_policy, 'present')
  assert.equal(result.materials?.extraChecks?.age_rating, 'present')
  assert.equal(result.materials?.extraChecks?.encryption, 'present')
  assert.ok(network.calls.every((item) => item.method === 'GET'))
  const json = JSON.stringify(result)
  for (const privateValue of [
    'synthetic@example.com',
    'private-review-login',
    'private-review-password',
    'https://example.com',
    'contactEmail',
    'demoAccountPassword',
  ])
    assert.ok(!json.includes(privateValue))
  network.options.missingContact = true
  network.options.missingImages = true
  const incomplete = await queryStoreStatus(job, network.store, network.transport)
  assert.equal(incomplete.code, 'observed')
  assert.equal(incomplete.materials?.checks.review_contact, 'missing')
  assert.equal(incomplete.materials?.checks.screenshots, 'missing')
  network.options.failPath = '/v1/appStoreVersions/V1/appStoreReviewDetail'
  const failure = await queryStoreStatus(job, network.store, network.transport)
  assert.equal(failure.code, 'request_rejected')
  assert.equal(failure.materials, undefined)
  assert.deepEqual(failure.versions, [])
  assert.equal(isStoreStatusSnapshot(failure), true)
})

test('各渠道材料投影保留未知边界，拒绝原因只返回固定分类', () => {
  const report = materialReport(
    { description: materialText(undefined), screenshots: materialImages([]) },
    { privacy_policy: 'unknown' },
  )
  assert.equal(report.checks.description, 'unknown')
  assert.equal(report.checks.screenshots, 'missing')
  assert.equal(report.checks.privacy, 'unchecked')
  assert.deepEqual(rejectionSummary('rejected', '隐私权限不清晰，详细原文秘密材料'), {
    availability: 'categorized',
    categories: ['privacy'],
  })
  assert.deepEqual(rejectionSummary('rejected', '特殊问题'), {
    availability: 'unclassified',
    categories: [],
  })
  assert.deepEqual(rejectionSummary('rejected', undefined), {
    availability: 'not_provided',
    categories: [],
  })
  assert.equal(rejectionSummary('approved', '拒绝原文'), undefined)
})

test('错应用、错版本及不完整目录不读取私人关系，未接入合规不冒充通过', async (t) => {
  const root = await directory(t)
  for (const scenario of ['foreign', 'version', 'pagination']) {
    const n = await appleReviewTestClient(join(root, `${scenario}.json`), binding, identifier)
    n.options.foreign = scenario === 'foreign'
    n.options.versionsNext = scenario === 'pagination'
    const result = await queryStoreStatus(
      { binding, identifier, materialVersionId: scenario === 'version' ? 'foreign-version' : 'V1' },
      n.store,
      n.transport,
    )
    assert.equal(result.code, 'invalid_response')
    assert.equal(result.materials, undefined)
    assert.ok(!n.calls.some((item) => item.path.endsWith('/appStoreReviewDetail')))
  }
  assert.equal(
    isStoreMaterialReport({ ...materials, checks: { ...materials.checks, privacy: 'present' } }),
    false,
  )
  assert.equal(isStoreMaterialReport({ ...materials, contactEmail: 'forbidden' }), false)
})

test('截图预算不抽样通过；语种无描述、非法网址、无需测试账号和未知字段保持准确结论', async (t) => {
  const root = await directory(t)
  const n = await appleReviewTestClient(join(root, 'profiles.json'), binding, identifier)
  const client: AppleReviewClient = {
    request: async (...args) => {
      const response = await n.client.request(...args)
      if (args[1].endsWith('/appStoreReviewDetail'))
        return {
          data: {
            id: 'D1',
            type: 'appStoreReviewDetails',
            attributes: {
              contactFirstName: '名',
              contactLastName: '姓',
              contactEmail: 'x',
              contactPhone: 'x',
              demoAccountRequired: false,
            },
          },
        }
      return response
    },
    list: async (path, query) =>
      path.endsWith('/appStoreVersionLocalizations')
        ? ['en-US', 'zh-Hans', 'ja', 'fr'].map((locale, i) => ({
            id: `L${i}`,
            type: 'appStoreVersionLocalizations',
            attributes: {
              locale,
              description: i === 0 ? '' : '描述',
              supportUrl: 'javascript:alert(1)',
            },
          }))
        : n.client.list(path, query),
  }
  const result = await inspectAppleStoreMaterials(client, {
    binding,
    identifier,
    materialVersionId: 'V1',
  })
  assert.equal(result.materials.checks.screenshots, 'unknown')
  assert.equal(result.materials.checks.description, 'missing')
  assert.equal(result.materials.checks.support_url, 'missing')
  assert.equal(result.materials.checks.demo_access, 'not_required')
  assert.equal(result.materials.checks.compliance, 'unchecked')
  assert.ok(!n.calls.some((item) => item.path.endsWith('/appScreenshots')))
})

test('资料检查独立缓存五个版本，失败保留成功，重启与schema3兼容且不改状态历史', async (t) => {
  const root = await directory(t),
    file = join(root, 'status.json'),
    key = 'a'.repeat(64)
  const store = new StoreStatusStore(file)
  const normal = { ...snapshot }
  delete normal.materials
  delete normal.materialVersionId
  const bytes = JSON.stringify({
    schemaVersion: 3,
    entries: [
      {
        key,
        requestedAt: 0,
        pending: false,
        snapshots: [normal],
        trackedSnapshots: [],
        manualRecords: [],
        queryHistory: [normal],
      },
    ],
  })
  await writeFile(file, bytes)
  assert.deepEqual((await store.tracking([key])).materialSnapshots, [])
  assert.equal(await readFile(file, 'utf8'), bytes)
  for (let i = 0; i < 6; i++) {
    const id = `V${i}`,
      version = snapshot.versions[0]
    assert.ok(version)
    await store.reserve(key, 1700000000000 + i * 11000)
    await store.finish(key, {
      ...snapshot,
      materialVersionId: id,
      versions: [{ ...version, versionId: id }],
    })
  }
  await store.reserve(key, 1700000100000)
  const failure = { ...snapshot, materialVersionId: 'V5', code: 'network' as const, versions: [] }
  delete failure.materials
  await store.finish(key, failure)
  const result = await new StoreStatusStore(file).tracking([key])
  assert.equal(result.materialSnapshots.length, 6)
  assert.equal(result.materialSnapshots[0]?.code, 'network')
  assert.equal(result.materialSnapshots[1]?.code, 'observed')
  assert.ok(!result.materialSnapshots.some((item) => item.materialVersionId === 'V0'))
  assert.deepEqual(result.snapshots, [normal])
  assert.deepEqual(result.queryHistory, [normal])
  assert.deepEqual((await store.tracking(['b'.repeat(64)])).materialSnapshots, [])
  assert.equal(JSON.parse(await readFile(file, 'utf8')).schemaVersion, 4)
})

test('API指定版本有来源、归属及空额外字段保护；不创建计划，错范围回报拒绝且共享冷却', async (t) => {
  const root = await directory(t)
  const projects = new FileProjectStore(join(root, 'projects.json'))
  const project = await new ProjectCatalog(projects).create('local', {
    name: '资料检查',
    key: 'materials',
    framework: 'native',
  })
  const applications = new FileApplicationStore(join(root, 'applications.json'))
  const catalog = new ApplicationCatalog(projects, applications)
  const application = await catalog.create('local', project.id, {
    name: 'iOS',
    identifier,
    platform: 'ios',
  })
  const bound = await catalog.bind('local', project.id, application.id, {
    channel: 'app_store',
    appId: '123456',
    credentialReference: 'synthetic-materials',
  })
  const cache = new StoreStatusStore(join(root, 'status.json'))
  let calls = 0
  const service = new StoreStatusService(
    projects,
    catalog,
    cache,
    {
      run: async (job) => {
        calls++
        assert.equal(job.materialVersionId, 'V1')
        return {
          ...snapshot,
          bindingId: bound.id,
          materialVersionId: 'wrong',
          versions: snapshot.versions.map((v) => ({ ...v, versionId: 'wrong' })),
        }
      },
      close() {},
    },
    ['http://127.0.0.1:5178'],
  )
  const app = await createApp(projects, { applicationStore: applications, storeStatus: service })
  t.after(() => app.close())
  const url = `/api/store-status/${project.id}/${application.id}/${bound.id}/materials`
  const headers = {
    host: '127.0.0.1',
    origin: 'http://127.0.0.1:5178',
    'x-release-harbor-query': '1',
  }
  assert.equal(
    (await app.inject({ method: 'POST', url, payload: { versionId: 'V1' } })).statusCode,
    403,
  )
  for (const payload of [
    {},
    { versionId: '../V1' },
    { versionId: 'V1', appId: 'other' },
    { versionId: 'V1', materials },
  ])
    assert.equal((await app.inject({ method: 'POST', url, headers, payload })).statusCode, 400)
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: url.replace(project.id, randomUUID()),
        headers,
        payload: { versionId: 'V1' },
      })
    ).statusCode,
    404,
  )
  const before = await readFile(join(root, 'applications.json'), 'utf8')
  const response = await app.inject({ method: 'POST', url, headers, payload: { versionId: 'V1' } })
  assert.equal(response.statusCode, 201)
  assert.equal(response.json().snapshot.code, 'invalid_response')
  const listed = await service.list()
  assert.equal(isStoreStatusResponse(listed), true)
  assert.equal(listed.materialSnapshots?.length, 1)
  assert.deepEqual(listed.snapshots, [])
  assert.deepEqual(listed.queryHistory, [])
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: url.replace('/materials', '/query'),
        headers,
        payload: {},
      })
    ).statusCode,
    409,
  )
  assert.equal(calls, 1)
  await assert.rejects(readFile(join(root, 'release-plans.json')), { code: 'ENOENT' })
  assert.equal(await readFile(join(root, 'applications.json'), 'utf8'), before)
  await catalog.updateBinding('local', project.id, application.id, bound.id, {
    appId: '123456',
    credentialReference: 'another-synthetic',
    expectedRevision: 1,
  })
  assert.deepEqual((await service.list()).materialSnapshots, [])
})

test('资料合同拒绝跨渠道、混合查询、失败携带旧报告、错版本和原始字段', () => {
  assert.equal(isStoreStatusJob({ binding, identifier, materialVersionId: 'V1' }), true)
  assert.equal(isStoreStatusSnapshot(snapshot), true)
  for (const invalid of [
    { ...snapshot, channel: 'oppo' },
    { ...snapshot, query: { kind: 'oppo_build', buildNumber: '42' } },
    { ...snapshot, materialVersionId: 'V2' },
    { ...snapshot, code: 'network', versions: [] },
    { ...snapshot, materials: { ...materials, password: 'forbidden' } },
  ])
    assert.equal(isStoreStatusSnapshot(invalid), false)
  assert.equal(
    isStoreStatusJob({
      binding: { ...binding, channel: 'oppo' },
      identifier,
      materialVersionId: 'V1',
    }),
    false,
  )
})

test('资料缺项与失败进入待办，新官方状态已推进时旧报告不重建缺项待办', () => {
  const target: StoreStatusTarget = {
    bindingId: binding.id,
    projectId: binding.projectId,
    projectName: '项目',
    applicationId: binding.applicationId,
    applicationName: '应用',
    platform: 'ios',
    identifier,
    channel: 'app_store',
    appId: binding.appId,
    querySupported: true,
    queryNotice: null,
  }
  const items = storeTodos([target], [], [], [], [snapshot])
  assert.equal(items[0]?.kind, 'materials')
  assert.match(items[0]?.guidance ?? '', /各语言截图、审核联系人/)
  const failure = { ...snapshot, code: 'network' as const, versions: [] }
  delete failure.materials
  assert.deepEqual(
    storeTodos([target], [], [], [], [failure, snapshot]).map((item) => item.kind),
    ['query_failed'],
  )
  const published = {
    ...snapshot,
    checkedAt: '2026-11-07T01:00:00.000Z',
    versions: snapshot.versions.map((item) => ({ ...item, state: 'published' as const })),
  }
  delete published.materials
  delete published.materialVersionId
  assert.deepEqual(storeTodos([target], [published], [], [], [snapshot]), [])
})
