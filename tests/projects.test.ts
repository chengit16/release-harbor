import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileProjectStore } from '../apps/api/src/project-store.ts'
import { createApp } from '../apps/api/src/app.ts'
import { ProjectCatalog } from '../packages/domain/src/index.ts'

const input = {
  name: '测试项目',
  key: 'sample-app',
  framework: 'react-native',
  description: '仅用于隔离测试',
}
async function fixture(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'release-harbor-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return {
    root,
    file: join(root, 'projects.json'),
    store: new FileProjectStore(join(root, 'projects.json')),
  }
}
test('项目创建后可持久读取，同一空间并发重复创建只允许一个成功', async (t) => {
  const { store, file } = await fixture(t)
  const catalog = new ProjectCatalog(store)
  const results = await Promise.allSettled([
    catalog.create('team-a', input),
    catalog.create('team-a', input),
  ])
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  const data = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(data.length, 1)
  assert.equal((await new FileProjectStore(file).list('team-a')).length, 1)
})
test('工作空间数据隔离，不能跨空间读取，即使知道项目 ID', async (t) => {
  const { store } = await fixture(t)
  const catalog = new ProjectCatalog(store)
  const project = await catalog.create('team-a', input)
  assert.deepEqual(await catalog.list('team-b'), [])
  await assert.rejects(catalog.get('team-b', project.id), { statusCode: 404 })
  await catalog.create('team-b', input)
})
test('损坏存储不会被创建请求覆盖', async (t) => {
  const { store, file } = await fixture(t)
  await writeFile(file, '{broken')
  await assert.rejects(new ProjectCatalog(store).create('local', input), { statusCode: 500 })
  assert.equal(await readFile(file, 'utf8'), '{broken')
})
test('HTTP 入口拒绝租户注入和跨站请求，不公开发布接口', async (t) => {
  const { store } = await fixture(t)
  const app = await createApp(store)
  t.after(() => app.close())
  const server = app.getHttpAdapter().getInstance()
  const created = await server.inject({ method: 'POST', url: '/api/projects', payload: input })
  assert.equal(created.statusCode, 201)
  const project = created.json().project
  assert.equal(project.workspaceId, 'local')
  assert.equal((await server.inject('/api/projects/' + project.id)).statusCode, 200)
  const injection = await server.inject({
    method: 'POST',
    url: '/api/projects',
    payload: { ...input, workspaceId: 'other' },
  })
  assert.equal(injection.statusCode, 400)
  assert.equal(
    (
      await server.inject({
        method: 'POST',
        url: '/api/projects',
        headers: { origin: 'https://other.example' },
        payload: input,
      })
    ).statusCode,
    403,
  )
  assert.equal(
    (await server.inject({ url: '/api/projects', headers: { host: 'other.example' } })).statusCode,
    403,
  )
  assert.equal(
    (await server.inject({ method: 'POST', url: '/api/publish', payload: {} })).statusCode,
    404,
  )
  assert.equal((await server.inject('/api/health')).json().publishingEnabled, false)
})
test('线上模式在认证与执行器尚未实现时明确停止', async (t) => {
  const { store } = await fixture(t)
  await assert.rejects(createApp(store, { mode: 'hosted' }), /在线运行尚未实现/)
})
