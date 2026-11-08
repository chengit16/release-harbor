/** @description 本机增强真实 Chrome 验收；独立宿主和临时目录，不触及用户账号或发布。 */
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import assert from 'node:assert/strict'

/** 覆盖恢复重建、下载、跟踪启停、通知权限拒绝及三种视口，截图供人工复核。 */
export async function runLocalEfficiencySmoke() {
  const root = await mkdtemp(join(tmpdir(), 'release-harbor-ui-local-')),
    origin = 'http://127.0.0.1:4402'
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'tests/fixtures/local-efficiency-server.ts'],
    {
      env: { ...process.env, RELEASE_HARBOR_DATA_DIR: root, RELEASE_HARBOR_PORT: '4402' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let output = ''
  child.stdout.on('data', (s) => (output += s))
  child.stderr.on('data', (s) => (output += s))
  let browser
  try {
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(origin + '/api/health')).ok) break
      } catch {}
      if (child.exitCode !== null) throw Error(output)
      await delay(100)
    }
    browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: 30000 })
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
      page = await context.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    let queries = 0
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/api/store-status/')) queries++
    })
    await page.goto(origin + '/?view=settings')
    await page.getByRole('tab', { name: '备份与恢复', exact: true }).waitFor()
    await page.getByRole('button', { name: '创建备份', exact: true }).click()
    await page.getByRole('status').filter({ hasText: '备份已创建' }).waitFor()
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: '下载备份', exact: true }).first().click()
    const downloaded = await downloadPromise,
      raw = await readFile(await downloaded.path(), 'utf8')
    assert.equal(raw.includes('synthetic-local-profile'), true, '引用可备份，但不得包含账号秘密')
    await page.locator('input[type=file]').setInputFiles({
      name: 'local-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(raw),
    })
    const modal = page.getByRole('dialog', { name: '确认恢复业务数据' })
    await modal.waitFor()
    await modal.getByRole('button', { name: '确认覆盖并恢复' }).click()
    await modal.waitFor({ state: 'hidden' })
    // 服务重建允许短暂断开；刷新不派发商店任务。
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(origin + '/api/health')).ok) {
          const v = await (await fetch(origin + '/api/local')).json()
          if (!v.restarting) break
        }
      } catch {}
      await delay(100)
    }
    await page.reload()
    await page.getByRole('tab', { name: '备份与恢复', exact: true }).waitFor()
    assert.equal(queries, 0)
    const pointer = JSON.parse(await readFile(join(root, '.local', 'active.json'), 'utf8'))
    assert.ok(pointer.generation)
    await page.getByRole('button', { name: '查看通知', exact: true }).click()
    const noticeDrawer = page.getByRole('dialog', { name: '通知', exact: true })
    await noticeDrawer.getByText('合成验收通知', { exact: true }).waitFor()
    await noticeDrawer.getByRole('button', { name: '标为已读' }).first().click()
    await noticeDrawer.getByText('已读', { exact: true }).first().waitFor()
    await noticeDrawer.getByRole('button', { name: '关闭通知', exact: true }).click()
    await page.getByRole('tab', { name: '通知设置与记录', exact: true }).click()
    await page.evaluate(() => {
      Notification.requestPermission = async () => 'denied'
    })
    await page.getByRole('switch', { name: '浏览器通知', exact: true }).click()
    await page.getByText('浏览器未允许通知，站内通知仍可使用', { exact: true }).waitFor()
    assert.equal(
      (await (await fetch(origin + '/api/local')).json()).state.browserNotifications,
      false,
    )
    await page.goto(origin + '/?view=reviews')
    await page.getByRole('button', { name: '查看详情', exact: true }).click()
    const drawer = page.getByRole('dialog', { name: '商店状态详情', exact: true })
    await drawer.getByRole('button', { name: '查询商店状态', exact: true }).click()
    await drawer.getByText('1.0.0', { exact: true }).waitFor()
    await drawer.getByRole('combobox', { name: '跟踪版本', exact: true }).click()
    await page.getByText('1.0.0 · 未提供构建号 · 100', { exact: true }).click()
    await drawer.getByRole('button', { name: '开启只读跟踪', exact: true }).click()
    await drawer.getByText('跟踪中', { exact: true }).waitFor()
    await drawer.getByRole('button', { name: '暂停跟踪', exact: true }).click()
    await drawer.getByText('已暂停', { exact: true }).waitFor()
    await drawer.getByRole('button', { name: '继续跟踪', exact: true }).click()
    await drawer.getByText('跟踪中', { exact: true }).waitFor()
    await drawer.getByRole('button', { name: '关闭商店详情', exact: true }).click()
    await page.getByRole('tab', { name: '跟踪任务', exact: true }).click()
    const tasks = page.getByRole('region', { name: '跟踪任务管理', exact: true })
    await tasks.getByText('版本 ID 100', { exact: true }).waitFor()
    await tasks.getByRole('button', { name: '暂停跟踪', exact: true }).click()
    await tasks.getByRole('button', { name: '继续跟踪', exact: true }).click()
    await tasks.getByRole('button', { name: '查看商店版本', exact: true }).click()
    await drawer.getByRole('button', { name: '结束跟踪', exact: true }).click()
    await drawer.getByText('已结束', { exact: true }).waitFor()
    const queryCount = queries
    await page.reload()
    await page.getByRole('dialog', { name: '商店状态详情', exact: true }).waitFor()
    assert.equal(queries, queryCount)
    await page.goto(origin + '/?view=settings&localTab=backups')
    await page
      .getByRole('checkbox', { name: /选择备份/ })
      .first()
      .check()
    await page.getByRole('button', { name: '删除所选备份', exact: true }).click()
    await page
      .getByRole('dialog', { name: '确认删除备份', exact: true })
      .getByRole('button', { name: '确认删除备份', exact: true })
      .click()
    await page
      .getByRole('dialog', { name: '确认删除备份', exact: true })
      .waitFor({ state: 'hidden' })
    await page.goto(origin + '/?view=settings&localTab=runtime')
    await page.getByRole('button', { name: '重新检查运行状态', exact: true }).waitFor()
    await page.getByText('合成检查工具', { exact: true }).waitFor()
    await page.getByRole('button', { name: '发送测试通知', exact: true }).click()
    await page.getByRole('status').filter({ hasText: '浏览器尚未允许通知' }).waitFor()
    await mkdir('artifacts', { recursive: true })
    for (const width of [1440, 375, 844]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.goto(origin + '/?view=settings')
      await page.getByRole('tab', { name: '备份与恢复', exact: true }).waitFor()
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        true,
        `设置页 ${width} 无溢出`,
      )
      const geometry = await page.evaluate(() => {
        const heading = document.querySelector('.page-heading h1')
        const crumb = document.querySelector('.topbar .ant-breadcrumb')
        return {
          heading: heading?.getBoundingClientRect().left,
          crumb: crumb?.getBoundingClientRect().left,
        }
      })
      assert.ok(Math.abs(geometry.heading - geometry.crumb) <= 2, JSON.stringify(geometry))
      await page.screenshot({ path: `artifacts/local-settings-${width}.png`, fullPage: true })
      await page.goto(origin + '/?view=settings&localTab=runtime')
      await page.getByText('合成检查工具', { exact: true }).waitFor()
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      await page.screenshot({ path: `artifacts/productivity-runtime-${width}.png`, fullPage: true })
      await page.goto(origin + '/?view=reviews&reviewMode=follows')
      await page.getByText('版本 ID 100', { exact: true }).waitFor()
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      await page.screenshot({ path: `artifacts/productivity-tasks-${width}.png`, fullPage: true })
      await page.goto(origin + '/?view=reviews')
      await page.getByRole('button', { name: '查看详情', exact: true }).click()
      await page.getByText('开启只读跟踪', { exact: true }).waitFor()
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        true,
        `跟踪页 ${width} 无溢出`,
      )
      await page.screenshot({ path: `artifacts/local-follow-${width}.png`, fullPage: true })
    }
    assert.deepEqual(errors, [])
    console.log(
      '本机增强 Chrome 验收通过：备份下载、预览恢复与服务重建、通知已读／拒绝权限、跟踪启停、刷新零查询、1440／375／844 布局。',
    )
  } finally {
    await browser?.close()
    child.kill('SIGTERM')
    await new Promise((resolve) => {
      if (child.exitCode !== null) resolve()
      else child.once('exit', resolve)
    })
    await rm(root, { recursive: true, force: true })
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await runLocalEfficiencySmoke()
