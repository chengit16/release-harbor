/** @description 多渠道绑定布局的隔离 Chrome 验收；只维护合成配置，不发起商店核验或发布。 */
import assert from 'node:assert/strict'
import { captureScreenshot } from './capture-screenshot.mjs'

/** 桌面六渠道对照与手机长目标、编辑焦点分别验证，不依赖用户的真实项目和账号。 */
export async function runBindingsLayoutSmoke(page, origin) {
  // 1. 复用隔离向导建立的安全目录，为独立合成应用登记六个渠道，避免影响其他发布场景。
  const url = new URL(page.url()),
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
  await page.goto(url.href)
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
  await page.setViewportSize({ width: 1440, height: 1000 })
}
