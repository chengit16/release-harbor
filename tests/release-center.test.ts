/** @description 发布中心跨端合同测试；汇总只读记录且不触发商店、预检或授权。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ProjectCatalog } from '../packages/domain/src/index.ts'
import { isReleaseCenterResponse } from '../packages/contracts/src/release-center.ts'
import { setup } from './fixtures/release-plans.ts'

test('发布中心只返回计划摘要，不暴露快照或账号引用', async (t) => {
  const fixture = await setup(t, 'android')
  const plan = await fixture.plans.freeze(...fixture.args, fixture.input)
  const checksBeforeRead = fixture.calls()
  const response = await fixture.api.inject({
    method: 'GET',
    url: '/api/release-center',
    headers: { host: '127.0.0.1' },
  })
  assert.equal(response.statusCode, 200)
  const body: unknown = response.json()
  assert.ok(isReleaseCenterResponse(body))
  assert.equal(fixture.calls(), checksBeforeRead)
  assert.equal(JSON.stringify(body).includes('credentialReference'), false)
  assert.equal(JSON.stringify(body).includes('snapshot'), false)
  assert.equal(JSON.stringify(body).includes('synthetic-plan-account'), false)
  assert.deepEqual(
    body.items.map((item) => item.id),
    [plan.id],
  )
  assert.equal(body.items[0]?.kind, 'plan')
  assert.equal(body.items[0]?.versionName, '1.2.3')
  assert.equal(body.items[0]?.state, 'awaiting_confirmation')
})

test('发布中心将批次作为单条记录并保留可用的应用发起入口', async (t) => {
  const fixture = await setup(t, 'android')
  await fixture.batches.create(...fixture.args, {
    requestId: randomUUID(),
    targets: [
      {
        bindingId: fixture.binding.id,
        artifactId: fixture.artifact.id,
        expectedBindingRevision: fixture.binding.revision,
        expectedArtifactSha256: fixture.artifact.sha256 ?? '',
        releaseNotes: '修复登录并优化启动体验',
        releasePolicy: { mode: 'after_approval' },
      },
    ],
  })
  const response = await fixture.api.inject({
    method: 'GET',
    url: '/api/release-center',
    headers: { host: '127.0.0.1' },
  })
  const body: unknown = response.json()
  assert.equal(response.statusCode, 200)
  assert.ok(isReleaseCenterResponse(body))
  assert.equal(body.projects[0]?.applications[0]?.id, fixture.application.id)
  assert.equal(body.items.length, 1)
  assert.equal(body.items[0]?.kind, 'batch')
  assert.deepEqual(body.items[0]?.channels, ['huawei'])
  assert.equal(body.items[0]?.state, 'draft')
})

test('发布中心只遍历可信空间，客户端查询参数不能扩大范围；数据损坏返回错误', async (t) => {
  const fixture = await setup(t, 'android')
  await new ProjectCatalog(fixture.projects).create('another-workspace', {
    key: 'outside-project',
    name: '不属于当前空间的项目',
    framework: 'native',
    description: '',
  })
  const other = await new ProjectCatalog(fixture.projects).create('local', {
    key: 'second-project',
    name: '另一个本机项目',
    framework: 'native',
    description: '',
  })
  const application = await fixture.catalog.create('local', other.id, {
    name: '无历史应用',
    platform: 'ios',
    identifier: 'com.example.other',
  })
  const before = await readFile(fixture.file, 'utf8')
  const response = await fixture.api.inject({
    method: 'GET',
    url: '/api/release-center?workspaceId=another-workspace',
    headers: { host: '127.0.0.1' },
  })
  const body: unknown = response.json()
  assert.ok(isReleaseCenterResponse(body))
  assert.equal(body.projects.length, 2)
  assert.ok(
    body.projects
      .find((project) => project.id === other.id)
      ?.applications.some((item) => item.id === application.id),
  )
  assert.equal(JSON.stringify(body).includes('不属于当前空间的项目'), false)
  assert.equal(await readFile(fixture.file, 'utf8'), before, '汇总读取不得写入发布状态或授权')
  await writeFile(join(fixture.root, 'applications.json'), '{broken')
  const broken = await fixture.api.inject({
    method: 'GET',
    url: '/api/release-center',
    headers: { host: '127.0.0.1' },
  })
  assert.equal(broken.statusCode, 500)
  assert.equal(Object.hasOwn(broken.json(), 'items'), false)
})
