/** @description 使用隔离空凭据目录验收只读预检界面，不录入或访问真实 Keychain，不请求商店。 */
import assert from 'node:assert/strict'
import { captureScreenshot } from './application-smoke.mjs'

/** 真实浏览器验证缺少档案时不能启动核验，键盘选择和移动布局均可用。 */
export async function runPreflightSmoke(page, origin) {
  await page.getByRole('tab', { name: '只读预检', exact: true }).click()
  await page.getByText('尚未配置凭据档案，请先运行 pnpm credentials add', { exact: true }).waitFor()
  assert.equal(await page.locator('input[type=password]').count(), 0)
  const binding = page.getByRole('combobox', { name: '待核验商店绑定', exact: true })
  await binding.click()
  await binding.press('ArrowDown')
  await binding.press('Enter')
  const artifact = page.getByRole('combobox', { name: '待核验安装包', exact: true })
  await artifact.click()
  await artifact.press('ArrowDown')
  await artifact.press('Enter')
  await page.getByText('未找到同渠道的已配置档案', { exact: false }).waitFor()
  assert.ok(await page.getByRole('button', { name: '运行只读预检', exact: true }).isDisabled())
  const url = new URL(page.url())
  const root = `${origin}/api/projects/${url.searchParams.get('project')}/applications/${url.searchParams.get('application')}`
  const bindings = (await (await fetch(root + '/bindings')).json()).items
  const artifacts = (await (await fetch(root + '/artifacts')).json()).items
  const rejected = await fetch(root + '/preflights', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bindingId: bindings[0].id,
      artifactId: artifacts.find((a) => a.status === 'ready').id,
      expectedBindingRevision: bindings[0].revision,
      expectedProfileRevision: 'a'.repeat(64),
    }),
  })
  assert.equal(rejected.status, 409)
  assert.deepEqual((await (await fetch(root + '/preflights')).json()).items, [])
  const reloaded = page.waitForResponse(
    (response) => response.url() === root + '/preflights' && response.request().method() === 'GET',
  )
  await page.getByRole('button', { name: '刷新目录与记录' }).click()
  await reloaded
  await page.getByRole('combobox', { name: '待核验商店绑定', exact: true }).waitFor()
  await page.getByText('尚未配置凭据档案，请先运行 pnpm credentials add', { exact: true }).waitFor()
  await captureScreenshot(page, 'artifacts/preflight-desktop.png')
  await page.setViewportSize({ width: 390, height: 844 })
  await captureScreenshot(page, 'artifacts/preflight-mobile.png')
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    '只读预检窄屏溢出',
  )
  await page.setViewportSize({ width: 1440, height: 1000 })
}
