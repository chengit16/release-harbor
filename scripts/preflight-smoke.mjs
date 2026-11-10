/** @description 合成账号只读预检界面验收；结果由夹具明确返回无法验证，不请求真实商店。 */
import { readNavigationUrl } from './navigation-state.mjs'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { captureScreenshot } from './application-smoke.mjs'

/** 验证页面选择、旧版本拒绝、显式启动和无法验证反馈，不能伪造商店成功。 */
export async function runPreflightSmoke(page, origin) {
  await page.getByRole('tab', { name: '发布前检查', exact: true }).click()
  const binding = page.getByRole('combobox', { name: '待核验商店绑定', exact: true })
  await binding.click()
  await binding.press('ArrowDown')
  await binding.press('Enter')
  const artifact = page.getByRole('combobox', { name: '待核验安装包', exact: true })
  await artifact.click()
  await artifact.press('ArrowDown')
  await artifact.press('Enter')
  assert.equal(await page.locator('input[type=password]').count(), 0)
  const url = await readNavigationUrl(page)
  const root = `${origin}/api/projects/${url.searchParams.get('project')}/applications/${url.searchParams.get('application')}`
  const saved = (await (await fetch(root + '/bindings')).json()).items[0]
  const artifacts = (await (await fetch(root + '/artifacts')).json()).items
  const rejected = await fetch(root + '/preflights', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bindingId: saved.id,
      artifactId: artifacts.find((a) => a.status === 'ready').id,
      expectedBindingRevision: saved.revision,
      expectedProfileRevision: 'a'.repeat(64),
    }),
  })
  assert.equal(rejected.status, 409)
  await page.getByRole('button', { name: '运行只读预检', exact: true }).click()
  const latest = page.getByRole('region', { name: '最新预检', exact: true })
  await latest.getByText('无法验证', { exact: true }).waitFor()
  assert.equal((await (await fetch(root + '/preflights')).json()).items[0].current, false)
  // 2. 六次用户显式触发生成隔离失败记录；翻页和查看详情不能产生额外预检。
  for (let expected = 2; expected <= 6; expected++) {
    await page.getByRole('button', { name: '运行只读预检', exact: true }).click()
    let settled = false
    for (let i = 0; i < 100; i++) {
      const views = (await (await fetch(root + '/preflights')).json()).items
      if (views.length === expected && views.every((v) => v.record.status !== 'running')) {
        settled = true
        break
      }
      await delay(50)
    }
    assert.ok(settled, '隔离预检未及时进入末态')
    await page.getByRole('heading', { name: `预检历史 ${expected} 条` }).waitFor()
    await latest.getByText('无法验证', { exact: true }).waitFor()
  }
  const history = page.getByRole('region', { name: '预检历史', exact: true })
  assert.equal(await history.locator('tbody tr[data-row-key]').count(), 5)
  assert.equal(await page.locator('[aria-label="应用列表"]').count(), 0)
  assert.equal(await page.getByRole('region', { name: '工作空间概况', exact: true }).count(), 0)
  assert.equal(await page.getByText('产物 SHA-256', { exact: true }).count(), 0)
  await history.getByTitle('下一页').click()
  assert.equal(await history.locator('tbody tr[data-row-key]').count(), 1)
  await history.getByRole('button', { name: /详\s*情/, exact: true }).click()
  const details = page.getByRole('dialog', { name: '预检记录详情', exact: true })
  await details.getByText('产物 SHA-256', { exact: true }).waitFor()
  await details.getByText('凭据引用', { exact: true }).waitFor()
  assert.ok(
    (await details.innerText()).includes(artifacts.find((a) => a.status === 'ready').sha256),
  )
  await details.getByRole('button', { name: '关闭预检详情', exact: true }).click()
  await details.waitFor({ state: 'hidden' })
  await history.getByTitle('上一页').click()
  await captureScreenshot(page, 'artifacts/preflight-desktop.png')
  // 3. 刷新恢复页签，浏览器前后退恢复定位，均不触发新的商店请求。
  await page.reload()
  await page.getByRole('tab', { name: '发布前检查', exact: true }).waitFor()
  assert.equal(
    await page.getByRole('tab', { name: '发布前检查', exact: true }).getAttribute('aria-selected'),
    'true',
  )
  await page.getByRole('tab', { name: '安装包', exact: true }).click()
  await page.goBack()
  assert.equal(
    await page.getByRole('tab', { name: '发布前检查', exact: true }).getAttribute('aria-selected'),
    'true',
  )
  await page.goForward()
  assert.equal(
    await page.getByRole('tab', { name: '安装包', exact: true }).getAttribute('aria-selected'),
    'true',
  )
  await page.getByRole('tab', { name: '发布前检查', exact: true }).click()
  await latest.getByText('无法验证', { exact: true }).waitFor()
  assert.equal((await (await fetch(root + '/preflights')).json()).items.length, 6)
  const applicationBounds = await page
    .getByRole('region', { name: '应用详情', exact: true })
    .boundingBox()
  const contentBounds = await page.locator('.content').boundingBox()
  assert.ok(applicationBounds.width > contentBounds.width * 0.85, '应用详情应占满内容区域')
  await page.setViewportSize({ width: 390, height: 844 })
  const appHeading = await page
    .getByRole('heading', { name: '验收 iOS', exact: true })
    .boundingBox()
  const crumbs = await page.locator('.workspace-breadcrumb').boundingBox()
  assert.ok(Math.abs(appHeading.x - crumbs.x) < 2, '移动端应用标题应与面包屑左对齐')
  await captureScreenshot(page, 'artifacts/preflight-mobile.png')
  await latest.getByRole('button', { name: '查看详情', exact: true }).click()
  await details.getByText('产物 SHA-256', { exact: true }).waitFor()
  const currentViews = (await (await fetch(root + '/preflights')).json()).items
  const newest = [...currentViews].sort((a, b) =>
    b.record.createdAt.localeCompare(a.record.createdAt),
  )[0]
  await details.getByText(newest.record.id, { exact: true }).waitFor()
  assert.ok(
    await details.evaluate((element) => element.scrollWidth <= element.clientWidth),
    '详情抽屉窄屏溢出',
  )
  await page.screenshot({ path: 'artifacts/preflight-detail-mobile.png' })
  await details.getByRole('button', { name: '关闭预检详情', exact: true }).click()
  await details.waitFor({ state: 'hidden' })
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    '只读预检窄屏溢出',
  )
  await page.setViewportSize({ width: 1440, height: 1000 })
}
