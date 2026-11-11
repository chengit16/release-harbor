/** @description Chrome 验收团队操作日志及发布操作者；使用独立服务、合成身份和本机计划，不连接商店。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'
import { setup } from './fixtures/release-plans.ts'
import { createApp } from '../apps/api/src/app.ts'
import { teamContext } from '../apps/api/src/local-team/access.ts'

const secret = ['synthetic', 'audit', 'browser'].join('-')
test(
  'Chrome 日志筛选、前后授权、发布操作者与旧历史；桌面及手机可读无溢出',
  { skip: process.env.RELEASE_HARBOR_TEAM_TEST_BROWSER !== '1', timeout: 90000 },
  async (t) => {
    const f = await setup(t, 'android', undefined, { team: true })
    assert.ok(f.team)
    const legacy = await f.plans.freeze(...f.args, f.input)
    await f.team.initialize('admin', secret)
    const admin = (await f.team.read())?.[0]
    assert.ok(admin)
    const publisher = await f.team.add('publisher', secret)
    await f.team.setPermissions(publisher.id, {
      revision: 0,
      menus: ['releases'],
      grants: [],
      applications: [
        {
          projectId: f.application.projectId,
          applicationId: f.application.id,
          operations: ['release_prepare'],
        },
      ],
    })
    const plan = await teamContext.run({ store: f.team, id: publisher.id, revision: 1 }, () =>
      f.plans.freeze(...f.args, { ...f.input, requestId: crypto.randomUUID() }),
    )
    const socket = createServer()
    await new Promise<void>((r) => socket.listen(0, '127.0.0.1', r))
    const address = socket.address()
    assert.ok(address && typeof address === 'object')
    const port = address.port
    await new Promise<void>((r) => socket.close(() => r()))
    const api = await createApp(f.projects, {
      team: f.team,
      port,
      applicationStore: f.applicationsStore,
      artifacts: f.artifacts,
      preflights: f.preflights,
      releasePlans: f.plans,
      execution: f.execution,
      preparations: f.preparations,
      batches: f.batches,
      webRoot: resolve('apps/web/dist'),
    })
    t.after(() => api.close())
    await api.listen(port, '127.0.0.1')
    const browser = await chromium.launch({ channel: 'chrome' })
    t.after(() => browser.close())
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    page.setDefaultTimeout(12000)
    const errors: string[] = [],
      writes: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('request', (r) => {
      if (r.method() === 'POST' && !r.url().includes('/team/')) writes.push(r.url())
    })
    await page.goto(`http://127.0.0.1:${port}/?view=members`)
    await page.getByLabel('登录名', { exact: true }).fill('admin')
    await page.getByLabel('密码', { exact: true }).fill(secret)
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await page.getByRole('heading', { name: '成员管理', exact: true }).waitFor()
    // 由界面产生一条真实账号变更，随后核对日志及安全前后范围。
    await page.getByRole('button', { name: '添加成员', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '添加成员', exact: true })
    await dialog.getByLabel('成员登录名', { exact: true }).fill('browser_member')
    await dialog.getByLabel('初始密码', { exact: true }).fill(secret)
    await dialog.getByRole('button', { name: '创建成员', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    await page.getByRole('tab', { name: '操作日志', exact: true }).click()
    await page.getByText('创建成员', { exact: true }).waitFor()
    await page.getByRole('combobox', { name: '按操作筛选日志' }).click()
    await page
      .locator('.ant-select-dropdown:visible')
      .getByText('创建成员', { exact: true })
      .click()
    await page.getByRole('button', { name: '查看变更前后范围' }).click()
    await page.getByText('成员尚未创建', { exact: true }).waitFor()
    await page.getByText('无应用操作权限', { exact: true }).waitFor()
    await mkdir('artifacts', { recursive: true })
    for (const width of [1440, 375, 844]) {
      await page.setViewportSize({ width, height: 1000 })
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      const title = await page.getByRole('heading', { name: '成员管理', exact: true }).boundingBox()
      const crumb = await page
        .locator('.topbar')
        .getByText('工作台', { exact: true })
        .evaluate((e) => {
          const range = document.createRange()
          range.selectNodeContents(e)
          return range.getBoundingClientRect().x
        })
      assert.ok(title && Math.abs(title.x - crumb) <= 2)
      await page.screenshot({ path: `artifacts/local-team-audit-${width}.png`, fullPage: true })
    }
    await page.getByRole('combobox', { name: '按成员筛选日志' }).click()
    await page
      .locator('.ant-select-dropdown:visible')
      .getByText('publisher', { exact: true })
      .click()
    await page.getByText('暂无符合条件的日志', { exact: true }).waitFor()
    // 原发布深链只读打开，身份来自已保存的合成发布记录，而不是当前管理员。
    async function openPlan(id: string) {
      await page.evaluate(
        ({ project, app, id }) => {
          history.pushState(
            null,
            '',
            `?view=releases&project=${project}&application=${app}&releaseTask=workspace&plan=${id}`,
          )
          window.dispatchEvent(new Event('harbor:url-change'))
        },
        { project: f.application.projectId, app: f.application.id, id },
      )
      await page.getByRole('dialog', { name: '发布摘要', exact: true }).waitFor()
      await page.getByRole('button', { name: '操作者与操作记录', exact: true }).click()
    }
    await openPlan(plan.id)
    await page.getByText('publisher', { exact: true }).waitFor()
    await page.getByText('已匹配本机记录', { exact: true }).waitFor()
    await page.screenshot({ path: 'artifacts/local-team-plan-actor-844.png', fullPage: true })
    await page.getByRole('button', { name: '关闭发布摘要', exact: true }).click()
    await openPlan(legacy.id)
    await page.getByText('历史未记录：此记录没有可匹配的团队操作者。', { exact: true }).waitFor()
    await page.screenshot({ path: 'artifacts/local-team-plan-historical.png' })
    assert.deepEqual(writes, [])
    assert.deepEqual(errors, [])
  },
)
