/** @description 多渠道绑定布局的隔离 Chrome 验收；只维护合成配置，不发起商店核验或发布。 */
import { openWorkbenchPage, readNavigationUrl } from './navigation-state.mjs'
import assert from 'node:assert/strict'
import { captureScreenshot } from './capture-screenshot.mjs'

/** 桌面六渠道对照与手机长目标、编辑焦点分别验证，不依赖用户的真实项目和账号。 */
export async function runBindingsLayoutSmoke(page, origin) {
  // 1. 复用隔离向导建立的安全目录，为独立合成应用登记六个渠道，避免影响其他发布场景。
  const url = await readNavigationUrl(page),
    project = url.searchParams.get('project')
  const identifier =
    'com.example.releaseharbor.bindings.long_package_name_for_readability_and_responsive_layout'
  const response = await fetch(`${origin}/api/projects/${project}/applications`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '多渠道绑定布局验收', platform: 'android', identifier }),
  })
  assert.equal(response.status, 201)
  const body = await response.json(),
    app = body.application ?? body
  const catalog = (await (await fetch(origin + '/api/credential-accounts')).json()).catalog
  const channels = ['huawei', 'xiaomi', 'oppo', 'vivo', 'meizu', 'honor']
  for (const channel of channels) {
    const account = catalog.accounts.find((a) => a.channel === channel && a.configured)
    assert.ok(account)
    const result = await fetch(
      `${origin}/api/projects/${project}/applications/${app.id}/bindings`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          channel,
          appId: ['xiaomi', 'oppo', 'vivo'].includes(channel) ? identifier : '89012345',
          credentialReference: account.reference,
        }),
      },
    )
    assert.equal(result.status, 201)
  }
  url.searchParams.set('application', app.id)
  url.searchParams.set('tab', 'bindings')
  await openWorkbenchPage(page, url.href)
  const panel = page.getByRole('region', { name: '商店绑定', exact: true })
  await panel.getByText('已绑定 6 个渠道', { exact: true }).waitFor()
  // 2. 表格集中呈现完整目标；绑定不持有实时预检事实，不显示统一的误导状态。
  const rows = panel.locator('tbody tr[data-row-key]')
  assert.equal(await rows.count(), 6)
  assert.equal(await panel.getByText('未预检', { exact: true }).count(), 0)
  assert.equal(await panel.getByText(identifier, { exact: true }).count(), 3)
  const box = await panel.locator('.binding-table').boundingBox()
  assert.ok(box && box.height < 720)
  await captureScreenshot(page, 'artifacts/bindings-compact-desktop.png')
  const first = rows
    .filter({ hasText: '华为 AppGallery' })
    .getByRole('button', { name: '编辑绑定', exact: true })
  await first.click()
  assert.equal(await panel.getByLabel('商店 appId', { exact: true }).inputValue(), '89012345')
  await panel.getByRole('button', { name: /取\s*消/, exact: true }).click()
  assert.ok(await first.evaluate((e) => e === document.activeElement), '桌面关闭编辑后应返回原渠道')
  // 3. 手机只挂载卡片，长包名换行；编辑与返回不能因布局切换丢失或落到其他渠道。
  await page.setViewportSize({ width: 390, height: 844 })
  await panel.locator('.binding-mobile-list').waitFor()
  assert.equal(await panel.locator('.binding-card').count(), 6)
  assert.equal(await panel.getByText(identifier, { exact: true }).count(), 3)
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    '多渠道绑定手机页面溢出',
  )
  await captureScreenshot(page, 'artifacts/bindings-compact-mobile.png')
  const mobile = panel
    .locator('.binding-card')
    .filter({ has: page.getByRole('heading', { name: '小米', exact: true }) })
    .getByRole('button', { name: '编辑绑定', exact: true })
  await mobile.click()
  assert.equal(await panel.getByLabel('小米目标包名', { exact: true }).inputValue(), identifier)
  await panel.getByRole('button', { name: /取\s*消/, exact: true }).click()
  assert.ok(
    await mobile.evaluate((e) => e === document.activeElement),
    '手机关闭编辑后应返回原渠道',
  )
  // 4. 同一六渠道长目标也验收批次紧凑布局；仅修改页面草稿，不准备或请求商店。
  url.searchParams.set('tab', 'plans')
  url.searchParams.set('releaseView', 'batch')
  url.searchParams.delete('batch')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await openWorkbenchPage(page, url.href)
  const batches = page.getByRole('region', { name: '多渠道发布批次', exact: true })
  await batches.getByRole('checkbox', { name: '选择全部', exact: true }).waitFor()
  const allocation = batches.getByLabel('批次渠道分配', { exact: true })
  assert.equal(await allocation.locator('tbody tr[data-row-key]').count(), 6)
  const allocationBox = await allocation.boundingBox()
  assert.ok(allocationBox && allocationBox.height < 640, '六渠道配置应压缩为紧凑行')
  await captureScreenshot(page, 'artifacts/batch-six-channels-desktop.png')
  await page.setViewportSize({ width: 390, height: 844 })
  await batches.getByRole('checkbox', { name: '小米', exact: true }).waitFor()
  assert.equal(await allocation.getByRole('combobox').count(), 0, '未选手机渠道只显示标题')
  await captureScreenshot(page, 'artifacts/batch-six-channels-mobile.png')
  await batches.getByRole('checkbox', { name: '小米', exact: true }).check()
  await allocation.getByRole('combobox', { name: '小米安装包', exact: true }).waitFor()
  await batches.getByRole('combobox', { name: '批次通用安装包', exact: true }).waitFor()
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    '长目标的批次配置与展开公共设置不可导致手机溢出',
  )
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 844, height: 390 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(viewport)
    await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth)
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      '批次小屏、横屏和平板不得横向溢出',
    )
  }
  await page.setViewportSize({ width: 375, height: 812 })
  await captureScreenshot(page, 'artifacts/batch-six-channels-expanded-mobile.png')
  await page.setViewportSize({ width: 1440, height: 1000 })
}
