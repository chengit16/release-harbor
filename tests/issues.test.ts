/** @description 问题中心的完整目录校验、只读接口和发布资源验收；临时目录隔离，不读账号或调用商店。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  isIssueCatalog,
  isIssueDocument,
  type IssueCatalog,
} from '../packages/contracts/src/index.ts'
import { IssuesService } from '../apps/api/src/issues.service.ts'
import { createApp } from '../apps/api/src/app.ts'
import { FileProjectStore } from '../apps/api/src/project-store.ts'
import { buildIssueAssets } from '../scripts/build-issue-assets.ts'
import { filterIssues } from '../apps/web/src/pages/issues/useIssues.ts'

async function fixture(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'harbor-issues-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = new IssuesService(),
    catalog = await source.list(),
    file = join(root, 'catalog.json')
  await writeFile(file, JSON.stringify(catalog))
  const service = new IssuesService(file, root)
  const app = await createApp(new FileProjectStore(join(root, 'projects.json')), {
    issues: service,
  })
  t.after(() => app.close())
  return { root, catalog, file, service, app }
}

test('问题目录拒绝重复、悬空关系、未知状态、非法日期和混入秘密字段', async (t) => {
  const { catalog } = await fixture(t)
  assert.ok(isIssueCatalog(catalog))
  const bad = (mutate: (value: IssueCatalog) => unknown) => {
    const value = structuredClone(catalog)
    mutate(value)
    assert.equal(isIssueCatalog(value), false)
  }
  bad((v) => {
    const first = v.items[0]
    assert.ok(first)
    v.items.push(first)
  })
  const original = catalog.items[0]
  assert.ok(original)
  for (const patch of [
    { status: 'unverified' },
    { updatedDate: '2026-02-30' },
    { clientSecret: 'synthetic-forbidden' },
    { verification: { result: 'passed', methods: [], detail: '无实际验证' }, status: 'resolved' },
    { rootCause: { confidence: 'certain', detail: '无依据' } },
    { relatedIssues: ['RH-9999'] },
    { evidence: { documents: ['../secret.md'], commits: [] } },
  ]) {
    const value = structuredClone(catalog)
    Object.assign(value.items[0] ?? {}, patch)
    assert.equal(isIssueCatalog(value), false)
  }
  for (const path of [
    'https://example.com/file.md',
    '/etc/file.md',
    'docs/../README.md',
    'docs/%2e%2e/file.md',
    'docs/a.html',
    'packages/private.md',
  ])
    assert.equal(isIssueDocument(path), false)
  assert.ok(isIssueDocument('docs/issues/README.md'))
})

test('问题 HTTP 查询真实返回目录和未确认原因，错误记录为 404，写操作和越界来源被拒绝', async (t) => {
  const f = await fixture(t),
    headers = { host: '127.0.0.1' }
  const list = await f.app.inject({ method: 'GET', url: '/api/issues', headers })
  assert.equal(list.statusCode, 200)
  assert.ok(isIssueCatalog(list.json()))
  const detail = await f.app.inject({ method: 'GET', url: '/api/issues/RH-0015', headers })
  assert.equal(detail.json().issue.rootCause.confidence, 'unknown')
  assert.equal(detail.json().issue.status, 'open')
  assert.equal(list.headers['cache-control'], 'no-store')
  assert.equal(
    (await f.app.inject({ method: 'GET', url: '/api/issues/RH-9999', headers })).statusCode,
    404,
  )
  assert.equal(
    (await f.app.inject({ method: 'POST', url: '/api/issues', headers, payload: {} })).statusCode,
    404,
  )
  assert.equal(
    (await f.app.inject({ method: 'GET', url: '/api/issues', headers: { host: 'evil.invalid' } }))
      .statusCode,
    403,
  )
  assert.equal(
    (
      await f.app.inject({
        method: 'GET',
        url: '/api/issues',
        headers: { ...headers, origin: 'https://evil.invalid' },
      })
    ).statusCode,
    403,
  )
})

test('损坏或缺失资源返回 503，不误报空目录且不覆盖源文件；证据只按登记序号读取', async (t) => {
  const f = await fixture(t),
    headers = { host: '127.0.0.1' }
  await mkdir(join(f.root, 'docs'), { recursive: true })
  await writeFile(join(f.root, 'CONTEXT.md'), '# 合成证据\n<script>不可执行</script>')
  const doc = await f.app.inject({ method: 'GET', url: '/api/issues/RH-0001/documents/0', headers })
  assert.equal(doc.statusCode, 200)
  assert.match(String(doc.headers['content-type']), /text\/plain/)
  assert.equal(doc.headers['x-content-type-options'], 'nosniff')
  assert.match(doc.body, /<script>/)
  for (const index of ['99', '-1', '00'])
    assert.equal(
      (
        await f.app.inject({
          method: 'GET',
          url: '/api/issues/RH-0001/documents/' + index,
          headers,
        })
      ).statusCode,
      404,
    )
  await writeFile(f.file, '{broken')
  const response = await f.app.inject({ method: 'GET', url: '/api/issues', headers })
  assert.equal(response.statusCode, 503)
  assert.ok(!response.body.includes(f.root))
  assert.equal(await readFile(f.file, 'utf8'), '{broken')
  await rm(f.file)
  assert.equal((await f.app.inject({ method: 'GET', url: '/api/issues', headers })).statusCode, 503)
  await writeFile(f.file, JSON.stringify(f.catalog))
  await symlink(join(f.root, 'CONTEXT.md'), join(f.root, 'README.md'))
  assert.equal(
    (await f.app.inject({ method: 'GET', url: '/api/issues/RH-0001/documents/1', headers }))
      .statusCode,
    503,
  )
})

test('构建显式复制档案和证据，脱离源码目录仍能查询，坏源不发布半套资源', async (t) => {
  const f = await fixture(t),
    output = join(f.root, 'dist')
  await buildIssueAssets(output)
  const packaged = new IssuesService(
    join(output, 'knowledge/catalog.json'),
    join(output, 'knowledge/documents'),
  )
  assert.deepEqual(await packaged.list(), f.catalog)
  assert.ok((await packaged.document('RH-0001', '0')).includes('应用发布领域'))
  const before = await readFile(join(output, 'knowledge/catalog.json'), 'utf8')
  await mkdir(join(f.root, 'docs/issues'), { recursive: true })
  await writeFile(join(f.root, 'docs/issues/catalog.json'), '{broken')
  await assert.rejects(buildIssueAssets(output, f.root))
  assert.equal(await readFile(join(output, 'knowledge/catalog.json'), 'utf8'), before)
  // 固定生产装配通过 webRoot 选择资源，不能依赖进程工作目录偶然有源码。
  const app = await createApp(new FileProjectStore(join(f.root, 'packaged-projects.json')), {
    webRoot: output,
  })
  t.after(() => app.close())
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/issues', headers: { host: '127.0.0.1' } }))
      .statusCode,
    200,
  )
})

test('搜索覆盖现象及原因，组合筛选保留未知问题而不混淆成相关修复成功', async (t) => {
  const { catalog } = await fixture(t),
    filters = { query: '超时', category: '', channel: 'xiaomi', status: '' }
  const matches = filterIssues(catalog.items, filters)
  assert.ok(matches.some((i) => i.id === 'RH-0015'))
  assert.ok(matches.some((i) => i.id === 'RH-0014'))
  assert.deepEqual(
    filterIssues(catalog.items, { ...filters, status: 'open' }).map((i) => i.id),
    ['RH-0015'],
  )
  assert.equal(filterIssues(catalog.items, { ...filters, query: '不存在的合成检索词' }).length, 0)
})

// 只映射明确存在过的手工分类，不把未知分类静默归入某个有效分类。
test('已知 preflight 分类只在读取时投影，未知分类仍拒绝且不改写源档案', async (t) => {
  const f = await fixture(t),
    value = structuredClone(f.catalog),
    first = value.items[0]
  assert.ok(first)
  Object.assign(first, { category: 'preflight' })
  const raw = JSON.stringify(value)
  await writeFile(f.file, raw)
  assert.equal((await f.service.list()).items[0]?.category, 'publishing')
  assert.equal(await readFile(f.file, 'utf8'), raw)
  Object.assign(first, { category: 'unknown_class' })
  await writeFile(f.file, JSON.stringify(value))
  await assert.rejects(f.service.list(), { statusCode: 503 })
})
