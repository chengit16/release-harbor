/** @description 真实 Chrome 对照管理员与成员的共享应用卡片；隔离数据验证菜单、应用范围与只读导航，不访问商店。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, type Page } from '@playwright/test'
import { ProjectCatalog } from '../packages/domain/src/index.ts'
import { setup } from './fixtures/release-plans.ts'
import { createApp } from '../apps/api/src/app.ts'

const secret = ['synthetic', 'cards', 'passphrase'].join('-')

/** 长函数保留原因：同一浏览器连续切换身份，以相同目录和视口对照卡片并核对零业务写入。 */
test(
  'Chrome 成员与管理员应用卡片一致，分组刷新与只读权限独立生效',
  {
    skip: process.env.RELEASE_HARBOR_TEAM_TEST_BROWSER !== '1',
    timeout: 60000,
  },
  async (t) => {
    // 1. 同一目录包含多平台、多项目与未授权应用，不能仅用前端隐藏证明范围隔离。
    const f = await setup(t, 'android', undefined, { team: true })
    assert.ok(f.team)
    await f.team.initialize('admin', secret)
    const member = await f.team.add('carduser', secret)
    const reader = await f.team.add('cardreader', secret)
    const ios = await f.catalog.create('local', f.application.projectId, {
      name: '合成应用 iOS',
      platform: 'ios',
      identifier: 'com.example.cardios',
    })
    const otherProject = await new ProjectCatalog(f.projects).create('local', {
      name: '另一项目',
      key: 'other-cards',
      framework: 'native',
    })
    const otherApp = await f.catalog.create('local', otherProject.id, {
      name: '另一项目应用',
      platform: 'harmony',
      identifier: 'com.example.cardharmony',
    })
    const hidden = await f.catalog.create('local', f.application.projectId, {
      name: '未授权保密应用',
      platform: 'android',
      identifier: 'com.example.hidden',
    })
    const applications = [f.application, ios, otherApp].map((app) => ({
      projectId: app.projectId,
      applicationId: app.id,
      operations: [],
    }))
    await f.team.setPermissions(member.id, {
      revision: 0,
      menus: ['projects', 'releases'],
      grants: [],
      applications,
    })
    await f.team.setPermissions(reader.id, {
      revision: 0,
      menus: ['projects'],
      grants: [],
      applications,
    })
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
    const origin = `http://127.0.0.1:${port}`
    const browser = await chromium.launch({ channel: 'chrome' })
    t.after(() => browser.close())
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    page.setDefaultTimeout(10000)
    const errors: string[] = [],
      mutations: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('request', (r) => {
      const path = new URL(r.url()).pathname
      if (r.method() !== 'GET' && path.startsWith('/api/') && !path.startsWith('/api/team/'))
        mutations.push(path)
    })
    async function login(username: string) {
      await page.getByLabel('登录名', { exact: true }).fill(username)
      await page.getByLabel('密码', { exact: true }).fill(secret)
      await page.getByRole('button', { name: '登录', exact: true }).click()
      await page.getByRole('region', { name: '全部应用', exact: true }).waitFor()
      await page
        .getByText('正在读取渠道配置…', { exact: true })
        .first()
        .waitFor({ state: 'hidden' })
    }
    const cards = page.locator('.application-directory-card')
    const primaryCard = cards.filter({
      has: page.getByRole('heading', { name: '合成应用', exact: true }),
    })
    await mkdir('artifacts', { recursive: true })
    await page.goto(origin + '/?view=projects')
    await login('admin')
    await page.getByRole('button', { name: '管理应用配置', exact: true }).first().waitFor()
    const adminGeometry = new Map<number, Awaited<ReturnType<typeof cardGeometry>>>()
    for (const width of [1440, 375, 844]) {
      await page.setViewportSize({ width, height: 900 })
      adminGeometry.set(width, await cardGeometry(page))
    }
    await page.getByRole('button', { name: '退出登录', exact: true }).click()
    await login('carduser')
    await primaryCard.waitFor()
    assert.equal(await cards.count(), 3)
    assert.equal(await page.getByText(hidden.name, { exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: '新建应用', exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: '新建项目', exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: '管理应用配置', exact: true }).count(), 0)
    await primaryCard.getByText('计划测试', { exact: true }).waitFor()
    await primaryCard.getByText('Android', { exact: true }).waitFor()
    await primaryCard.getByText('华为 AppGallery', { exact: true }).waitFor()
    await cards.filter({ hasText: ios.name }).getByText('iOS', { exact: true }).waitFor()
    // 2. 比较实际列宽和卡片内容样式，维护按钮的差异不应产生另一套卡片视觉。
    for (const width of [1440, 375, 844]) {
      await page.setViewportSize({ width, height: 900 })
      assert.deepEqual(await cardGeometry(page), adminGeometry.get(width))
      const crumb = await page
        .locator('.topbar')
        .getByText('工作台', { exact: true })
        .evaluate((element) => {
          const range = document.createRange()
          range.selectNodeContents(element)
          return range.getBoundingClientRect().x
        })
      const heading = await page
        .getByRole('heading', { name: '应用管理', exact: true })
        .boundingBox()
      assert.ok(heading && Math.abs(heading.x - crumb) <= 2)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await page.screenshot({ path: `artifacts/member-application-cards-${width}.png` })
    }
    // 3. 分组及刷新恢复共享目录定位；导航零写入，配置接口仍拒绝成员。
    await page.getByRole('combobox', { name: '应用项目分组', exact: true }).click()
    await page
      .locator('.ant-select-dropdown:visible')
      .getByText('另一项目', { exact: true })
      .click()
    await cards.filter({ hasText: otherApp.name }).waitFor()
    assert.equal(await cards.count(), 1)
    await page.reload()
    await cards.filter({ hasText: otherApp.name }).waitFor()
    assert.equal(await cards.count(), 1)
    await cards.getByRole('button', { name: '前往发布中心', exact: true }).click()
    await page.getByRole('heading', { name: '发布中心', exact: true }).waitFor()
    const navigation = await page.evaluate(() => window.history.state.harborNavigation.search)
    assert.equal(new URLSearchParams(navigation).get('releaseApplication'), otherApp.id)
    const rejected = await context.request.post(
      `${origin}/api/projects/${f.application.projectId}/applications`,
      {
        headers: { origin, 'x-release-harbor-plan': '1' },
        data: { name: '禁止创建', platform: 'android', identifier: 'com.example.denied' },
      },
    )
    assert.equal(rejected.status(), 403)
    await page.getByRole('button', { name: '退出登录', exact: true }).click()
    await page.goto(origin + '/?view=projects')
    await login('cardreader')
    await primaryCard.waitFor()
    assert.equal(await cards.count(), 3)
    assert.equal(await page.getByRole('button', { name: '前往发布中心', exact: true }).count(), 0)
    await page.goto(
      `${origin}/?view=projects&project=${f.application.projectId}&application=${f.application.id}`,
    )
    await page.getByRole('heading', { name: '应用管理', exact: true }).waitFor()
    await primaryCard.waitFor()
    assert.equal(await page.getByRole('button', { name: '管理应用配置', exact: true }).count(), 0)
    assert.deepEqual(mutations, [])
    assert.deepEqual(errors, [])
  },
)

/** 只比较共同内容区域，管理员独有维护按钮不纳入高度比较。 */
async function cardGeometry(page: Page) {
  const card = page
    .locator('.application-directory-card')
    .filter({ has: page.getByRole('heading', { name: '合成应用', exact: true }) })
  await card.getByText('华为 AppGallery', { exact: true }).waitFor()
  return card.evaluate((node) => {
    const title = node.querySelector('h3'),
      identifier = node.querySelector('.application-identifier')
    // 浏览器内直接检查结构，避免嵌套具名函数引入 TypeScript 转译辅助依赖。
    if (!title || !identifier) throw new Error('共享卡片内容缺失')
    return {
      width: Math.round(node.getBoundingClientRect().width),
      columns: getComputedStyle(node.parentElement ?? node).gridTemplateColumns.split(' ').length,
      padding: getComputedStyle(identifier.parentElement ?? identifier).padding,
      fontSize: getComputedStyle(title).fontSize,
      identifier: identifier.textContent,
      channels: node.querySelector('.application-directory-channels')?.textContent,
    }
  })
}
