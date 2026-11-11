/** @description 用合成 ZIP／plist 验收真实浏览器产物流程，样本不能代表可安装或可发布 IPA。 */
import { readNavigationUrl } from './navigation-state.mjs'
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
  const url = await readNavigationUrl(page)
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
  // 3. 详情单条删除同步刷新存储列表；批量删除仅允许失败／已清理记录，刷新后保持删除结果。
  const panel = page.getByRole('region', { name: '安装包记录', exact: true })
  const wrong = panel
    .locator('.ant-card')
    .filter({ has: page.getByText('身份错配.ipa', { exact: true }) })
  await wrong.getByRole('button', { name: '删除记录', exact: true }).click()
  const deletion = page.getByRole('dialog', { name: '确认删除安装包记录', exact: true })
  await deletion.getByRole('button', { name: '确认删除记录', exact: true }).click()
  await wrong.waitFor({ state: 'hidden' })
  assert.equal((await (await fetch(endpoint)).json()).items.length, 2)
  await panel.getByText('安装包下载与清理', { exact: true }).click()
  const storage = panel.getByRole('region', { name: '安装包存储管理', exact: true })
  assert.equal(await storage.getByText('身份错配.ipa', { exact: true }).count(), 0)
  await storage.getByRole('checkbox', { name: '选择当前筛选（最多一百项）', exact: true }).check()
  assert.equal(
    await storage.getByRole('button', { name: '删除所选记录', exact: true }).isDisabled(),
    true,
  )
  const state = storage.getByRole('combobox', { name: '安装包状态', exact: true })
  await state.click()
  await page.locator('.ant-select-dropdown:visible').getByText('检查失败', { exact: true }).click()
  await storage.getByRole('checkbox', { name: '选择当前筛选（最多一百项）', exact: true }).check()
  assert.equal(
    await storage.getByRole('button', { name: '清理所选原文件', exact: true }).isDisabled(),
    true,
  )
  await storage.getByRole('button', { name: '删除所选记录', exact: true }).click()
  await deletion.getByRole('button', { name: '确认删除记录', exact: true }).click()
  await storage.getByText('暂无匹配安装包', { exact: true }).waitFor()
  await page.reload()
  await panel.getByText('身份检查通过', { exact: true }).waitFor()
  const remaining = (await (await fetch(endpoint)).json()).items
  assert.equal(remaining.length, 1)
  assert.equal(remaining[0].status, 'ready')
  await captureScreenshot(page, 'artifacts/artifact-delete-mobile.png')
  await page.setViewportSize({ width: 1440, height: 1000 })
}
