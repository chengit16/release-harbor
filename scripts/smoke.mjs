/** @description 使用独立端口和临时目录验收工作台与应用配置，不污染用户数据。 */
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { captureScreenshot, runApplicationSmoke } from './application-smoke.mjs'
import { runArtifactSmoke } from './artifact-smoke.mjs'
import { runPreflightSmoke } from './preflight-smoke.mjs'

// 浏览器验收使用独立端口和临时存储，不污染用户的默认项目数据。
const data = await mkdtemp(join(tmpdir(), 'release-harbor-ui-'))
const port = '4401'
const origin = `http://127.0.0.1:${port}`
const child = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/workbench-server.ts'], {
  env: {
    ...process.env,
    RELEASE_HARBOR_DATA_DIR: data,
    RELEASE_HARBOR_PORT: port,
    RELEASE_HARBOR_MODE: 'local',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
child.stdout.on('data', (chunk) => {
  output += chunk
})
child.stderr.on('data', (chunk) => {
  output += chunk
})
let browser
try {
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(output)
    try {
      ready = (await fetch(origin + '/api/health')).ok
    } catch {}
    if (ready) break
    await delay(100)
  }
  assert.ok(ready, '本机测试 API 未及时启动：' + output)
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  })
  page.setDefaultTimeout(10000)
  const credentialLeaks = []
  let materialRequests = 0
  page.on('request', (request) => {
    const body = request.postData() || ''
    const url = new URL(request.url())
    if (body.includes('synthetic-browser-secret') || body.includes('BEGIN PRIVATE KEY')) {
      materialRequests++
      if (url.hostname !== '127.0.0.1' || !/^\/v1\/sessions\/[^/]+\/profile$/.test(url.pathname))
        credentialLeaks.push(url.pathname)
    }
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(origin)
  await page.getByRole('heading', { name: '从第一个项目开始' }).waitFor()
  await mkdir('artifacts', { recursive: true })
  await captureScreenshot(page, 'artifacts/workspace-empty.png')
  await page.getByRole('button', { name: '新建项目', exact: true }).click()
  await page.getByLabel('项目名称', { exact: true }).fill('浏览器验收项目')
  await page.getByLabel('项目标识').fill('browser-smoke')
  await page.getByLabel('项目说明').fill('仅保存在隔离测试目录，退出后清理。')
  await page.getByRole('button', { name: '创建项目', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '项目已保存' }).waitFor()
  await page.reload()
  await page.getByRole('heading', { name: '浏览器验收项目', exact: true }).waitFor()
  const items = await (await fetch(origin + '/api/projects')).json()
  assert.equal(items.items.length, 1)
  assert.equal(items.items[0].key, 'browser-smoke')
  await captureScreenshot(page, 'artifacts/workspace.png')
  await runApplicationSmoke(page, origin)
  await runArtifactSmoke(page, origin)
  await runPreflightSmoke(page, origin)
  await page.getByRole('menuitem', { name: '渠道能力' }).click()
  await page.getByRole('heading', { name: '华为 AppGallery', exact: true }).waitFor()
  await captureScreenshot(page, 'artifacts/channels-desktop.png')
  await page.getByRole('menuitem', { name: '演进路线' }).click()
  await page.getByRole('heading', { name: '在线控制台', exact: true }).waitFor()
  await captureScreenshot(page, 'artifacts/roadmap-desktop.png')
  await page.setViewportSize({ width: 390, height: 844 })
  await captureScreenshot(page, 'artifacts/roadmap-mobile.png')
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    '路线图窄屏溢出',
  )
  await page.getByRole('menuitem', { name: '渠道能力' }).click()
  await captureScreenshot(page, 'artifacts/channels-mobile.png')
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    '渠道页窄屏溢出',
  )
  await page.getByRole('menuitem', { name: '项目空间' }).click()
  await captureScreenshot(page, 'artifacts/workspace-mobile.png')
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    '移动布局存在横向溢出',
  )
  assert.deepEqual(errors, [], '浏览器出现未处理错误')
  assert.deepEqual(credentialLeaks, [], '秘密材料不能发往控制面或其它接口')
  assert.ok(materialRequests >= 3, '华为和 Apple 材料应通过真实配置通道提交')
  assert.ok(
    await page.evaluate(
      () =>
        ![...Object.values(localStorage), ...Object.values(sessionStorage), location.href].some(
          (value) =>
            value.includes('synthetic-browser-secret') || value.includes('BEGIN PRIVATE KEY'),
        ),
    ),
    '浏览器持久化状态不能包含材料',
  )
  console.log(
    '浏览器验收通过：项目、Android/iOS、商店绑定、版本冲突、安装包上传与真实检查、错配和损坏包、页面账号向导、绑定自动回填、只读预检失败反馈、持久化、全页面窄屏和无运行时异常。',
  )
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0]
  if (page)
    await page
      .screenshot({ path: 'artifacts/smoke-failure.png', fullPage: true })
      .catch(() => undefined)
  throw error
} finally {
  await browser?.close()
  if (child.exitCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve))
    child.kill('SIGTERM')
    await exited
  }
  await rm(data, { recursive: true, force: true })
}
