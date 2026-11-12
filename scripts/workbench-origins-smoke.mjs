/** @description 真实生产宿主的 HTTPS 隧道 Chrome 回归；隔离团队账号与合成 APK，不连接真实商店。 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { request as upstreamRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from '@playwright/test'
import { syntheticApk } from '../tests/fixtures/apk.ts'
import { LocalTeamStore } from '../apps/api/src/local-team/store.ts'

const data = await mkdtemp(join(tmpdir(), 'harbor-origin-browser-'))
const allocator = createServer().listen(0, '127.0.0.1')
await once(allocator, 'listening')
const address = allocator.address()
assert.ok(address && typeof address === 'object')
const port = address.port
await new Promise((resolve) => allocator.close(resolve))
const base = `http://127.0.0.1:${port}`
const origin = 'https://rotated-workbench.example'
const host = new URL(origin).host
const password = ['synthetic', 'team', 'browser'].join('-')
const child = spawn(process.execPath, ['--import', 'tsx', 'apps/api/src/main.ts'], {
  env: {
    ...process.env,
    RELEASE_HARBOR_DATA_DIR: data,
    RELEASE_HARBOR_PORT: String(port),
    RELEASE_HARBOR_MODE: 'local',
    RELEASE_HARBOR_TUNNEL_ORIGIN: origin,
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

  const bindings = (await (await fetch(base + app + '/bindings')).json()).items
  await new LocalTeamStore(data).initialize('admin', password)

  // 2. 模拟保留 Host 的 HTTPS 代理，浏览器自行发送 Origin 和 Cookie；不连接真实隧道。
  browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: 30000 })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(15000)
  await page.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== origin) return route.abort()
    const headers = await request.allHeaders()
    const response = await new Promise((resolve, reject) => {
      const call = upstreamRequest(
        base + url.pathname + url.search,
        {
          method: request.method(),
          headers: { ...headers, host, 'accept-encoding': 'identity' },
        },
        (reply) => {
          const chunks = []
          reply.on('data', (chunk) => chunks.push(chunk))
          reply.on('error', reject)
          reply.on('end', () => {
            const headers = { ...reply.headers }
            delete headers.connection
            delete headers['keep-alive']
            delete headers['transfer-encoding']
            if (headers['set-cookie']) headers['set-cookie'] = headers['set-cookie'].join('\n')
            resolve({ status: reply.statusCode, headers, body: Buffer.concat(chunks) })
          })
        },
      )
      call.on('error', reject)
      call.end(request.postDataBuffer() ?? undefined)
    })
    await route.fulfill(response)
  })
  let executionRequests = 0
  page.on('request', (request) => {
    if (request.method() !== 'GET' && /confirm|\/execute/.test(request.url())) executionRequests++
  })
  await page.goto(
    `${origin}/?view=releases&project=${project.id}&application=${application.id}&releaseTask=workspace&releaseView=batch`,
  )
  await page.getByRole('heading', { name: '本机团队工作台' }).waitFor()
  await page.getByLabel('登录名', { exact: true }).fill('admin')
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  const panel = page.getByRole('region', { name: '多渠道发布批次', exact: true })
  await panel.waitFor()
  const session = (await page.context().cookies(origin + '/api')).find((item) =>
    item.name.startsWith('rh_team_'),
  )
  assert.ok(session?.secure && session.httpOnly && session.sameSite === 'Strict')
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
  assert.equal(
    await panel.getByRole('button', { name: '复用配置与常用模板', exact: true }).count(),
    0,
  )
  const saved = page.waitForResponse(
    (r) => r.url().includes('/api/local/reuse/') && r.request().method() === 'POST',
  )
  // 批次模板入口暂时隐藏；仍以浏览器实际 Origin 验证保留的模板 API 来源门禁。
  const savedResult = await page.evaluate(
    async ({ projectId, applicationId, entries }) => {
      const response = await fetch(`/api/local/reuse/${projectId}/${applicationId}`, {
        method: 'POST',
        signal: AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/json', 'X-Release-Harbor-Local': '1' },
        body: JSON.stringify({ name: '来源回归模板', kind: 'batch', entries }),
      })
      // 在浏览器中消费正文，避免脚本请求结束后 CDP 无法再读取短生命周期响应体。
      return { status: response.status, body: await response.text() }
    },
    {
      projectId: project.id,
      applicationId: application.id,
      entries: bindings.map((binding) => ({
        bindingId: binding.id,
        releaseNotes: '来源回归说明',
        mode: 'after_approval',
        huaweiAction: 'save_draft',
      })),
    },
  )
  const savedResponse = await saved
  assert.equal(savedResult.status, 201, savedResult.body)
  assert.equal(savedResponse.status(), 201)
  assert.equal(savedResponse.request().headers().origin, origin)

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
    batch = (
      await page.evaluate(
        async (path) => (await (await fetch(path)).json()).items,
        app + '/release-batches',
      )
    )[0]
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
  const attempts = await page.evaluate(
    async (path) => (await (await fetch(path)).json()).items,
    app + '/release-attempts',
  )
  assert.equal(attempts.length, 0)
  console.log(
    '新 HTTPS 域名：团队登录成功，模板保存 201、五渠道准备 202；没有确认、执行或真实商店操作。',
  )
} catch (error) {
  // 清理浏览器可能还需等待在途请求，先报告失败位置，避免只看到测试长期无输出。
  console.error(error)
  throw error
} finally {
  await browser?.close()
  if (child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit')
    child.kill('SIGTERM')
    await exited
  }
  await rm(data, { recursive: true, force: true })
}
