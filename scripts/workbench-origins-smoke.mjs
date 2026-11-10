/** @description 真实生产宿主的隧道来源 Chrome 回归；空账号目录与合成 APK，不连接真实商店。 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from '@playwright/test'
import { syntheticApk } from '../tests/fixtures/apk.ts'

const data = await mkdtemp(join(tmpdir(), 'harbor-origin-browser-'))
const allocator = createServer().listen(0, '127.0.0.1')
await once(allocator, 'listening')
const address = allocator.address()
assert.ok(address && typeof address === 'object')
const port = address.port
await new Promise((resolve) => allocator.close(resolve))
const base = `http://127.0.0.1:${port}`
const origin = 'https://6e03b6cd.r20.vip.cpolar.cn'
const child = spawn(process.execPath, ['--import', 'tsx', 'apps/api/src/main.ts'], {
  env: {
    ...process.env,
    RELEASE_HARBOR_DATA_DIR: data,
    RELEASE_HARBOR_PORT: String(port),
    RELEASE_HARBOR_MODE: 'local',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
child.stdout.on('data', (chunk) => (output += chunk))
child.stderr.on('data', (chunk) => (output += chunk))
let browser
try {
  // 1. 真实入口使用隔离数据根；没有任何凭据，准备只能形成缺少账号的检查事实。
  let ready = false
  for (let i = 0; i < 100; i++) {
    assert.equal(child.exitCode, null, output)
    ready = await fetch(base + '/api/health').then(
      (r) => r.ok,
      () => false,
    )
    if (ready) break
    await delay(100)
  }
  assert.ok(ready, output)
  const create = async (path, body) => {
    const r = await fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    assert.equal(r.status, 201, await r.clone().text())
    return r.json()
  }
  const { project } = await create('/api/projects', {
    name: '来源隔离回归',
    key: 'origins-smoke',
    framework: 'native',
  })
  const identifier = 'com.example.origins'
  const { application } = await create(`/api/projects/${project.id}/applications`, {
    name: '来源合成应用',
    platform: 'android',
    identifier,
  })
  const app = `/api/projects/${project.id}/applications/${application.id}`
  for (const channel of ['huawei', 'xiaomi', 'oppo', 'vivo', 'meizu']) {
    await create(app + '/bindings', {
      channel,
      appId: ['xiaomi', 'oppo', 'vivo'].includes(channel) ? identifier : '123456',
      credentialReference: 'synthetic-origin-missing-account',
    })
  }
  const apk = await syntheticApk(data, identifier)
  assert.ok(apk, '来源浏览器回归需要实际 APK 解析工具')
  const upload = await fetch(base + app + '/artifacts', {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      'x-artifact-name': 'origin-synthetic.apk',
      'x-artifact-size': String(apk.length),
    },
    body: apk,
  })
  assert.equal(upload.status, 202)
  let artifact
  for (let i = 0; i < 100; i++) {
    artifact = (await (await fetch(base + app + '/artifacts')).json()).items[0]
    if (artifact?.status === 'ready') break
    await delay(100)
  }
  assert.equal(artifact?.status, 'ready')

  // 2. 将指定域名完全映射到隔离宿主，保留浏览器实际 Origin，不访问用户的真实隧道数据。
  browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: 30000 })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(15000)
  await page.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== origin) return route.abort()
    const response = await route.fetch({
      url: base + url.pathname + url.search,
      headers: { ...request.headers(), host: new URL(base).host },
    })
    await route.fulfill({ response })
  })
  let executionRequests = 0
  page.on('request', (request) => {
    if (request.method() !== 'GET' && /confirm|\/execute/.test(request.url())) executionRequests++
  })
  await page.goto(
    `${origin}/?view=releases&project=${project.id}&application=${application.id}&releaseTask=workspace&releaseView=batch`,
  )
  const panel = page.getByRole('region', { name: '多渠道发布批次', exact: true })
  await panel.getByRole('checkbox', { name: '选择全部', exact: true }).check()
  const common = panel.getByRole('button', { name: /批量设置/ })
  if (!(await panel.getByRole('combobox', { name: '批次通用安装包' }).isVisible()))
    await common.click()
  const select = panel.getByRole('combobox', { name: '批次通用安装包', exact: true })
  await select.click()
  await select.press('ArrowDown')
  await select.press('Enter')
  await panel.getByRole('textbox', { name: '批次通用更新说明', exact: true }).fill('来源回归说明')
  await panel.getByRole('button', { name: '应用到 5 个已选渠道', exact: true }).click()
  await panel.getByRole('button', { name: '复用配置与常用模板', exact: true }).click()
  await panel.getByRole('textbox', { name: '发布模板名称', exact: true }).fill('来源回归模板')
  const saved = page.waitForResponse(
    (r) => r.url().includes('/api/local/reuse/') && r.request().method() === 'POST',
  )
  await panel.getByRole('button', { name: '保存当前配置为模板', exact: true }).click()
  const savedResponse = await saved
  assert.equal(savedResponse.status(), 201, await savedResponse.text())
  assert.equal(savedResponse.request().headers().origin, origin)
  await panel.getByText('模板已保存，未准备或执行发布', { exact: true }).waitFor()

  // 3. 明确点击五渠道准备，验证 HTTP 受理及五个失败事实；绝不确认或执行。
  const prepared = page.waitForResponse(
    (r) => /\/release-batches\/[^/]+\/prepare$/.test(r.url()) && r.request().method() === 'POST',
  )
  await panel.getByRole('button', { name: '准备 5 个渠道', exact: true }).click()
  const preparedResponse = await prepared
  assert.equal(preparedResponse.status(), 202, await preparedResponse.text())
  assert.equal(preparedResponse.request().headers().origin, origin)
  let batch
  for (let i = 0; i < 100; i++) {
    batch = (await (await fetch(base + app + '/release-batches')).json()).items[0]
    if (batch?.revisions[0]?.preparedAt) break
    await delay(100)
  }
  assert.equal(batch?.draft.length, 5)
  const revision = batch?.revisions[0]
  assert.ok(revision?.preparedAt)
  assert.equal(revision.targets.length, 5)
  assert.ok(revision.targets.every((target) => target.status === 'failed'))
  assert.equal(revision.run, null)
  assert.equal(executionRequests, 0)
  assert.equal((await (await fetch(base + app + '/release-attempts')).json()).items.length, 0)
  console.log('指定隧道 Origin：模板保存 201、五渠道准备 202；没有确认、执行或真实商店操作。')
} finally {
  await browser?.close()
  if (child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit')
    child.kill('SIGTERM')
    await exited
  }
  await rm(data, { recursive: true, force: true })
}
