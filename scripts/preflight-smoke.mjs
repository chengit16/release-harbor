/** @description 合成账号只读预检界面验收；结果由夹具明确返回无法验证，不请求真实商店。 */
import assert from 'node:assert/strict'
import { captureScreenshot } from './application-smoke.mjs'

/** 验证页面选择、旧版本拒绝、显式启动和无法验证反馈，不能伪造商店成功。 */
export async function runPreflightSmoke(page, origin) {
  await page.getByRole('tab', { name: '只读预检', exact: true }).click()
  const binding = page.getByRole('combobox', { name: '待核验商店绑定', exact: true })
  await binding.click()
  await binding.press('ArrowDown')
  await binding.press('Enter')
  const artifact = page.getByRole('combobox', { name: '待核验安装包', exact: true })
  await artifact.click()
  await artifact.press('ArrowDown')
  await artifact.press('Enter')
  assert.equal(await page.locator('input[type=password]').count(), 0)
  const url = new URL(page.url())
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
  await page.getByText('无法验证', { exact: true }).waitFor()
  assert.equal((await (await fetch(root + '/preflights')).json()).items[0].current, false)
  await captureScreenshot(page, 'artifacts/preflight-desktop.png')
  await page.setViewportSize({ width: 390, height: 844 })
  await captureScreenshot(page, 'artifacts/preflight-mobile.png')
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    '只读预检窄屏溢出',
  )
  await page.setViewportSize({ width: 1440, height: 1000 })
}
