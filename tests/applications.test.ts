/** @description 应用／绑定的归属、原子冲突、损坏保护和 HTTP 合同验收；只使用临时合成数据。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isApplication, isChannelBinding, isRecord } from '../packages/contracts/src/index.ts'
import {
  ApplicationCatalog,
  ProjectCatalog,
  validateApplication,
  validateBindingUpdate,
  validateChannelBinding,
} from '../packages/domain/src/index.ts'
import { FileProjectStore } from '../apps/api/src/project-store.ts'
import { FileApplicationStore } from '../apps/api/src/application-store.ts'
import { createApp } from '../apps/api/src/app.ts'

const android = {
  name: '合成 Android 应用',
  platform: 'android',
  identifier: 'com.example.android',
}
const ios = { name: '合成 iOS 应用', platform: 'ios', identifier: 'com.example.ios' }
const binding = { channel: 'huawei', appId: '123456', credentialReference: 'test-profile' }

async function fixture(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'release-harbor-app-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const projects = new FileProjectStore(join(root, 'projects.json'))
  const catalog = new ProjectCatalog(projects)
  const a = await catalog.create('team-a', {
    name: '项目 A',
    key: 'project-a',
    framework: 'native',
  })
  const b = await catalog.create('team-a', {
    name: '项目 B',
    key: 'project-b',
    framework: 'native',
  })
  const other = await catalog.create('team-b', {
    name: '其他空间',
    key: 'project-c',
    framework: 'native',
  })
  const file = join(root, 'applications.json')
  const store = new FileApplicationStore(file)
  return { root, file, projects, store, a, b, other, apps: new ApplicationCatalog(projects, store) }
}

test('应用身份校验拒绝未知字段、空值、通配符和非法平台', () => {
  for (const input of [
    null,
    [],
    {},
    { ...android, workspaceId: 'injected' },
    { ...android, name: ' ' },
    { ...android, platform: 'web' },
    { ...android, identifier: '../file.apk' },
    { ...android, identifier: 'com.*' },
    { ...android, identifier: 'com.1bad' },
  ])
    assert.throws(() => validateApplication(input), { statusCode: 400 })
  assert.equal(
    validateApplication({ ...ios, identifier: 'com.Example-app' }).identifier,
    'com.Example-app',
  )
  for (const input of [
    { ...binding, password: 'synthetic' },
    { ...binding, credentialReference: '/tmp/file' },
    { ...binding, credentialReference: '{"token":"synthetic"}' },
    { ...binding, channel: 'meizu' },
  ])
    assert.throws(() => validateChannelBinding(input), { statusCode: 400 })
  for (const expectedRevision of [0, -1, 1.5, '1', null, Number.MAX_SAFE_INTEGER])
    assert.throws(
      () =>
        validateBindingUpdate({ appId: '42', credentialReference: 'profile', expectedRevision }),
      { statusCode: 400 },
    )
})

test('应用按空间与平台唯一，并发冲突后队列仍可使用', async (t) => {
  const { apps, store, a, b, other } = await fixture(t)
  const results = await Promise.allSettled(
    Array.from({ length: 3 }, () => apps.create('team-a', a.id, android)),
  )
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  for (const result of results)
    if (result.status === 'rejected') assert.equal(result.reason.statusCode, 409)
  await assert.rejects(apps.create('team-a', b.id, android), { statusCode: 409 })
  const second = await apps.create('team-b', other.id, android)
  assert.equal((await apps.list('team-b', other.id)).length, 1)
  await assert.rejects(apps.get('team-a', a.id, second.id), { statusCode: 404 })
  await assert.rejects(apps.list('', a.id), { statusCode: 404 })
  await assert.rejects(apps.list('team-b', a.id), { statusCode: 404 })
  const first = (await store.list('team-a', a.id))[0]
  assert.ok(first)
  await assert.rejects(apps.get('team-a', b.id, first.id), { statusCode: 404 })
  assert.equal((await apps.create('team-a', a.id, ios)).platform, 'ios')
})

test('绑定保护平台、应用渠道及远端目标唯一性，编辑原子比较版本', async (t) => {
  const { apps, a, b, other } = await fixture(t)
  const app = await apps.create('team-a', a.id, android)
  const apple = await apps.create('team-a', a.id, ios)
  await assert.rejects(apps.bind('team-a', a.id, apple.id, binding), { statusCode: 400 })
  await assert.rejects(apps.bind('team-a', b.id, app.id, binding), { statusCode: 404 })
  const results = await Promise.allSettled([
    apps.bind('team-a', a.id, app.id, binding),
    apps.bind('team-a', a.id, app.id, binding),
  ])
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  const saved = (await apps.bindings('team-a', a.id, app.id))[0]
  assert.ok(saved)
  assert.equal(saved.verification, 'not_checked')
  assert.notEqual(saved.appId, app.identifier)
  const second = await apps.create('team-a', b.id, { ...android, identifier: 'com.example.second' })
  await assert.rejects(apps.bind('team-a', b.id, second.id, binding), { statusCode: 409 })
  const third = await apps.create('team-b', other.id, android)
  await apps.bind('team-b', other.id, third.id, binding)
  const changes = { appId: '654321', credentialReference: 'new-profile', expectedRevision: 1 }
  const edits = await Promise.allSettled([
    apps.updateBinding('team-a', a.id, app.id, saved.id, changes),
    apps.updateBinding('team-a', a.id, app.id, saved.id, changes),
  ])
  assert.equal(edits.filter((result) => result.status === 'fulfilled').length, 1)
  const rejected = edits.find((result) => result.status === 'rejected')
  assert.ok(rejected?.status === 'rejected')
  assert.equal(rejected.reason.statusCode, 409)
  assert.equal((await apps.bindings('team-a', a.id, app.id))[0]?.revision, 2)
  await assert.rejects(apps.updateBinding('team-a', b.id, second.id, saved.id, changes), {
    statusCode: 404,
  })
})

test('应用文件独立持久化，旧项目字节保持不变，成功后不残留临时文件', async (t) => {
  const { apps, projects, root, file, a } = await fixture(t)
  const original = await readFile(join(root, 'projects.json'), 'utf8')
  assert.deepEqual(await apps.list('team-a', a.id), [])
  const app = await apps.create('team-a', a.id, android)
  await apps.bind('team-a', a.id, app.id, binding)
  const reloaded = new ApplicationCatalog(projects, new FileApplicationStore(file))
  assert.equal((await reloaded.get('team-a', a.id, app.id)).identifier, android.identifier)
  assert.equal(
    (await reloaded.bindings('team-a', a.id, app.id))[0]?.credentialReference,
    binding.credentialReference,
  )
  assert.equal(await readFile(join(root, 'projects.json'), 'utf8'), original)
  assert.deepEqual((await readdir(root)).sort(), ['applications.json', 'projects.json'])
})

test('损坏、未知版本和断裂关联都拒绝读写并保留原字节', async (t) => {
  const { apps, file, a } = await fixture(t)
  const app = await apps.create('team-a', a.id, android)
  await apps.bind('team-a', a.id, app.id, binding)
  const source = await readFile(file, 'utf8')
  // 每个损坏样本都从相同有效快照构造，防止测试自身的修改相互污染。
  for (const corrupt of [
    '{broken',
    source.replace('"schemaVersion": 1', '"schemaVersion": 2'),
    source.replace('"verification": "not_checked"', '"verification": "verified"'),
    source.replace('"applicationId": "' + app.id + '"', '"applicationId": "missing"'),
    source.replace('"platform": "android"', '"platform": "ios"'),
  ]) {
    await writeFile(file, corrupt)
    await assert.rejects(apps.list('team-a', a.id), { statusCode: 500 })
    await assert.rejects(apps.create('team-a', a.id, ios), { statusCode: 500 })
    assert.equal(await readFile(file, 'utf8'), corrupt)
  }
  await writeFile(file, source)
  assert.equal((await apps.list('team-a', a.id)).length, 1)
})

test('HTTP 应用与绑定端到端合同，拒绝父级错配、注入及跨站写入', async (t) => {
  const { projects, store, other } = await fixture(t)
  const local = await new ProjectCatalog(projects).create('local', {
    name: '本机项目',
    key: 'local-project',
    framework: 'native',
  })
  const sibling = await new ProjectCatalog(projects).create('local', {
    name: '另一项目',
    key: 'sibling-project',
    framework: 'native',
  })
  const app = await createApp(projects, { applicationStore: store })
  t.after(() => app.close())
  const server = app
  const root = `/api/projects/${local.id}/applications`
  const created = await server.inject({ method: 'POST', url: root, payload: android })
  assert.equal(created.statusCode, 201)
  const data: unknown = created.json()
  assert.ok(isRecord(data) && isApplication(data.application))
  const application = data.application
  assert.equal(application.workspaceId, 'local')
  assert.equal((await server.inject(`${root}/${application.id}`)).statusCode, 200)
  assert.equal((await server.inject(root)).json().items.length, 1)
  assert.equal(
    (await server.inject(`/api/projects/${sibling.id}/applications/${application.id}`)).statusCode,
    404,
  )
  assert.equal((await server.inject(`/api/projects/${other.id}/applications`)).statusCode, 404)
  const bindRoot = `${root}/${application.id}/bindings`
  const bound = await server.inject({ method: 'POST', url: bindRoot, payload: binding })
  assert.equal(bound.statusCode, 201)
  const boundData: unknown = bound.json()
  assert.ok(isRecord(boundData) && isChannelBinding(boundData.binding))
  const target = `${bindRoot}/${boundData.binding.id}`
  const update = { appId: 'new-target', credentialReference: 'new-profile', expectedRevision: 1 }
  assert.equal(
    (await server.inject({ method: 'PUT', url: target, payload: update })).statusCode,
    200,
  )
  assert.equal(
    (await server.inject({ method: 'PUT', url: target, payload: update })).statusCode,
    409,
  )
  for (const payload of [
    { ...android, workspaceId: 'other' },
    { ...android, identifier: 'com.*' },
  ])
    assert.equal((await server.inject({ method: 'POST', url: root, payload })).statusCode, 400)
  assert.equal(
    (
      await server.inject({
        method: 'PUT',
        url: target,
        payload: { ...update, verification: 'verified' },
      })
    ).statusCode,
    400,
  )
  for (const headers of [{ origin: 'https://untrusted.example' }, { host: 'untrusted.example' }])
    assert.equal(
      (await server.inject({ method: 'POST', url: root, headers, payload: android })).statusCode,
      403,
    )
  assert.equal((await server.inject('/api/health')).json().publishingEnabled, false)
  assert.equal((await server.inject({ method: 'POST', url: '/api/publish' })).statusCode, 404)
})
