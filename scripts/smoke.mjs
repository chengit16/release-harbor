import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'

// 浏览器验收使用独立端口和临时存储，不污染用户的默认项目数据。
const data = await mkdtemp(join(tmpdir(), 'release-harbor-ui-'))
const port = '4401'
const origin = `http://127.0.0.1:${port}`
const child = spawn(process.execPath, ['--import', 'tsx', 'apps/api/src/main.ts'], {
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
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(origin)
  await page.getByRole('heading', { name: '从第一个项目开始' }).waitFor()
  await mkdir('artifacts', { recursive: true })
  await page.screenshot({ path: 'artifacts/workspace-empty.png', fullPage: true })
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
  await page.screenshot({ path: 'artifacts/workspace.png', fullPage: true })
  await page.getByRole('button', { name: '渠道能力' }).click()
  await page.getByRole('heading', { name: '华为 AppGallery', exact: true }).waitFor()
  await page.getByRole('button', { name: '演进路线' }).click()
  await page.getByRole('heading', { name: '在线控制台', exact: true }).waitFor()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '项目空间' }).click()
  await page.screenshot({ path: 'artifacts/workspace-mobile.png', fullPage: true })
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    '移动布局存在横向溢出',
  )
  assert.deepEqual(errors, [], '浏览器出现未处理错误')
  console.log('浏览器验收通过：创建、重载持久化、导航、移动布局和无运行时异常。')
} finally {
  await browser?.close()
  if (child.exitCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve))
    child.kill('SIGTERM')
    await exited
  }
  await rm(data, { recursive: true, force: true })
}
