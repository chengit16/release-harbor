/** @description 用合成 ZIP／plist 验收真实浏览器产物流程，样本不能代表可安装或可发布 IPA。 */
import assert from 'node:assert/strict'
import { syntheticIpa } from '../tests/fixtures/ipa.ts'
import { captureScreenshot } from './application-smoke.mjs'

/** 验证手动上传、真实子进程检查、失败证据及刷新持久化，不调用商店。 */
export async function runArtifactSmoke(page, origin) {
  const applicationSwitch = page.getByRole('combobox', { name: '切换应用', exact: true })
  await applicationSwitch.click()
  await applicationSwitch.fill('验收 iOS')
  await applicationSwitch.press('Enter')
  await page.getByRole('heading', { name: '验收 iOS', exact: true }).waitFor()
  await page.getByRole('tab', { name: '安装包', exact: true }).click()
  const input = page.locator('input[type=file]')
  // 1. 选择不会自动发送；只有明确点击按钮后才接收实际字节。
  const url = new URL(page.url())
  const endpoint = `${origin}/api/projects/${url.searchParams.get('project')}/applications/${url.searchParams.get('application')}/artifacts`
  await input.setInputFiles({
    name: '合成验收.ipa',
    mimeType: 'application/octet-stream',
    buffer: syntheticIpa('com.example.ios', true),
  })
  assert.equal((await (await fetch(endpoint)).json()).items.length, 0)
  await page.getByRole('button', { name: '上传并检查', exact: true }).click()
  await page.getByText('身份检查通过', { exact: true }).waitFor({ timeout: 20000 })
  const data = (await (await fetch(endpoint)).json()).items[0]
  assert.equal(data.identity.packageName, 'com.example.ios')
  assert.equal(data.identity.buildNumber, '42')
  assert.equal(data.sha256.length, 64)
  assert.ok(!JSON.stringify(data).includes('payload.ipa'))
  await page.reload()
  await page.getByRole('tab', { name: '安装包', exact: true }).click()
  await page.getByText('身份检查通过', { exact: true }).waitFor()
  await captureScreenshot(page, 'artifacts/artifact-desktop.png')

  // 2. 身份错配和损坏包保存失败事实，不能被正常上传回执误标为可用。
  await page.locator('input[type=file]').setInputFiles({
    name: '身份错配.ipa',
    mimeType: 'application/octet-stream',
    buffer: syntheticIpa('com.example.wrong'),
  })
  await page.getByRole('button', { name: '上传并检查', exact: true }).click()
  await page
    .getByRole('alert')
    .filter({ hasText: '与当前登记应用不一致' })
    .waitFor({ timeout: 20000 })
  await page.locator('input[type=file]').setInputFiles({
    name: '损坏样本.ipa',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('broken'),
  })
  await page.getByRole('button', { name: '上传并检查', exact: true }).click()
  await page
    .getByRole('alert')
    .filter({ hasText: '无法读取安装包身份或版本' })
    .waitFor({ timeout: 20000 })
  const records = (await (await fetch(endpoint)).json()).items
  assert.equal(records.filter((item) => item.status === 'ready').length, 1)
  assert.equal(records.filter((item) => item.status === 'failed').length, 2)
  await page.setViewportSize({ width: 390, height: 844 })
  await captureScreenshot(page, 'artifacts/artifact-mobile.png')
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    '安装包页窄屏溢出',
  )
  await page.setViewportSize({ width: 1440, height: 1000 })
}
