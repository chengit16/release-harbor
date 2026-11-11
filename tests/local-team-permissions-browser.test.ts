/** @description 真实 Chrome 验证管理员授权、成员限定菜单和只读审核；独立数据根，不调用商店。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { setup } from './fixtures/release-plans.ts'
import { createApp } from '../apps/api/src/app.ts'
import { StoreStatusService } from '../apps/api/src/store-status.service.ts'
import { StoreStatusStore } from '../apps/api/src/store-status-store.ts'

const secret = ['synthetic', 'browser', 'passphrase'].join('-')
test(
  'Chrome 管理员授权、成员菜单／缓存只读和手机授权弹窗',
  { skip: process.env.RELEASE_HARBOR_TEAM_TEST_BROWSER !== '1', timeout: 60000 },
  async (t) => {
    const f = await setup(t, 'android', undefined, { team: true })
    assert.ok(f.team)
    await f.team.initialize('admin', secret)
    await f.team.add('reviewer', secret)
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
    await f.catalog.bind(...f.args, {
      channel: 'tencent',
      appId: '654321',
      credentialReference: 'synthetic-second',
    })
    let calls = 0
    const status = new StoreStatusService(
      f.projects,
      f.catalog,
      new StoreStatusStore(join(f.root, 'browser-status.json')),
      {
        async run() {
          calls++
          throw Error('禁止真实查询')
        },
        close() {},
      },
      [],
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
      storeStatus: status,
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
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    page.setDefaultTimeout(10000)
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`http://127.0.0.1:${port}/?view=reviews`)
    async function login(username: string) {
      await page.getByLabel('登录名', { exact: true }).fill(username)
      await page.getByLabel('密码', { exact: true }).fill(secret)
      await page.getByRole('button', { name: '登录', exact: true }).click()
    }
    await login('admin')
    await page.getByRole('menuitem', { name: '成员管理', exact: true }).click()
    await page.getByRole('heading', { name: '成员管理', exact: true }).waitFor()
    await page.reload()
    await page.getByRole('heading', { name: '成员管理', exact: true }).waitFor()
    assert.equal(new URL(page.url()).searchParams.get('view'), 'members')
    await mkdir('artifacts', { recursive: true })
    await page.screenshot({ path: 'artifacts/local-team-members-desktop.png' })
    // 独立菜单迁移同时检查文字起点与窄屏入口，不以无溢出替代几何验收。
    for (const width of [1440, 375, 844]) {
      await page.setViewportSize({ width, height: 900 })
      const heading = await page
        .getByRole('heading', { name: '成员管理', exact: true })
        .boundingBox()
      const crumb = await page
        .locator('.topbar')
        .getByText('工作台', { exact: true })
        .evaluate((element) => {
          const range = document.createRange()
          range.selectNodeContents(element)
          return range.getBoundingClientRect().x
        })
      assert.ok(heading && Math.abs(heading.x - crumb) <= 2)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await page.screenshot({ path: `artifacts/local-team-members-${width}.png` })
    }
    await page.getByRole('button', { name: '打开工作台菜单', exact: true }).click()
    const menu = page.getByRole('dialog', { name: '工作台菜单', exact: true })
    await menu.getByRole('menuitem', { name: '成员管理', exact: true }).click()
    await menu.waitFor({ state: 'hidden' })
    await page.setViewportSize({ width: 1440, height: 900 })
    assert.equal(await page.locator('.topbar').getByRole('button', { name: '成员管理' }).count(), 0)
    await page
      .getByRole('listitem')
      .filter({ has: page.getByText('reviewer', { exact: true }) })
      .getByRole('button', { name: '成员授权', exact: true })
      .click()
    const dialog = page.getByRole('dialog', { name: '成员授权 · reviewer' })
    await dialog.getByText('可见菜单', { exact: true }).waitFor()
    await dialog.locator('.team-application-permissions').first().waitFor()
    assert.equal(await dialog.locator('.team-application-permissions').count(), 1)
    await dialog.getByText('全部渠道 · 当前 2 个', { exact: true }).waitFor()
    await dialog.getByRole('checkbox', { name: '审核状态', exact: true }).check()
    await dialog.getByRole('checkbox', { name: '查看审核缓存', exact: true }).check()
    await mkdir('artifacts', { recursive: true })
    await page.screenshot({ path: 'artifacts/local-team-permissions-desktop.png' })
    for (const width of [375, 844]) {
      await page.setViewportSize({ width, height: 900 })
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await page.screenshot({ path: `artifacts/local-team-permissions-${width}.png` })
    }
    await dialog.getByRole('button', { name: '保存权限', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: '退出登录', exact: true }).click()
    await login('reviewer')
    await page.getByRole('heading', { name: '审核状态', exact: true }).waitFor()
    await page.waitForURL((url) => url.searchParams.get('view') === 'reviews')
    await page.getByRole('button', { name: '查询商店状态', exact: true }).first().waitFor()
    assert.equal(
      await page.getByRole('button', { name: '查询商店状态', exact: true }).first().isDisabled(),
      true,
    )
    assert.equal(await page.getByRole('menuitem', { name: '成员管理', exact: true }).count(), 0)
    assert.equal(await page.getByText('跟踪任务', { exact: true }).count(), 0)
    await page.getByRole('button', { name: '查看详情', exact: true }).first().click()
    await page.getByRole('button', { name: '关闭商店详情' }).waitFor()
    assert.equal(await page.getByText('设置审核自动跟踪', { exact: true }).count(), 0)
    await page.screenshot({ path: 'artifacts/local-team-reviewer-mobile.png' })
    await page.getByRole('button', { name: '关闭商店详情' }).click()
    await page.reload()
    await page.getByRole('heading', { name: '审核状态', exact: true }).waitFor()
    assert.equal(calls, 0)
    // 同一文档内切换账号，验证模块级公开草稿不会被下一位成员恢复。
    await page.getByRole('button', { name: '退出登录', exact: true }).click()
    await login('admin')
    async function compose() {
      await page.evaluate(
        ({ project, application, binding }) => {
          history.pushState(
            null,
            '',
            `?view=releases&project=${project}&application=${application}&releaseTask=workspace&releaseCompose=configured&releaseSelected=${binding}`,
          )
          window.dispatchEvent(new Event('harbor:url-change'))
        },
        { project: f.application.projectId, application: f.application.id, binding: f.binding.id },
      )
      await page.getByLabel('更新说明', { exact: true }).waitFor()
    }
    await compose()
    await page.getByLabel('更新说明', { exact: true }).fill('管理员尚未保存的合成说明')
    await page.getByRole('button', { name: '退出登录', exact: true }).click()
    await login('publisher')
    await compose()
    assert.equal(await page.getByLabel('更新说明', { exact: true }).inputValue(), '')
    assert.equal(await page.getByRole('button', { name: '管理应用配置', exact: true }).count(), 0)
    assert.equal(
      await page.getByRole('radio', { name: '提交审核', exact: true }).isDisabled(),
      false,
    )
    await page.screenshot({ path: 'artifacts/local-team-publisher-mobile.png' })
    assert.deepEqual(errors, [])
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  },
)
