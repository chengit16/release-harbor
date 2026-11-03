/** @description 页面账号配置的合成浏览器流程，仅配合显式内存安全库夹具，不访问真实 Keychain。 */
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { captureScreenshot } from './capture-screenshot.mjs'

/** 调用方已打开向导；锁定渠道与自由选择均支持，不通过 API 偷填秘密。 */
export async function fillCredentialWizard(page, name, channel) {
  const dialog = page.getByRole('dialog', { name: '新增商店账号', exact: true })
  await dialog.waitFor()
  await dialog.getByLabel('账号名称', { exact: true }).fill(name)
  const selector = dialog.getByRole('combobox', { name: '商店渠道', exact: true })
  if (!(await selector.isDisabled()) && channel === 'app_store') {
    await selector.click()
    await selector.press('ArrowDown')
    await selector.press('Enter')
  }
  await dialog.getByRole('button', { name: '下一步', exact: true }).click()
  if (channel === 'huawei') {
    await dialog.getByLabel('Client ID', { exact: true }).fill('synthetic-browser-client')
    await dialog.getByLabel('Client Secret', { exact: true }).fill('synthetic-browser-secret')
  } else {
    await dialog
      .getByLabel('Issuer ID', { exact: true })
      .fill('11111111-1111-4111-8111-111111111111')
    await dialog.getByLabel('Key ID', { exact: true }).fill('ABCDEFGHIJ')
    const privateKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({
      format: 'pem',
      type: 'pkcs8',
    })
    await dialog.locator('input[type=file]').setInputFiles({
      name: 'synthetic-key.p8',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from(privateKey),
    })
    await dialog.getByText('synthetic-key.p8', { exact: true }).waitFor()
  }
  await captureScreenshot(page, 'artifacts/credential-wizard-desktop.png')
  await page.setViewportSize({ width: 390, height: 844 })
  await captureScreenshot(page, 'artifacts/credential-wizard-mobile.png')
  assert.ok(
    await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth),
    '账号向导窄屏溢出',
  )
  await page.setViewportSize({ width: 1440, height: 1000 })
  await dialog.getByRole('button', { name: '下一步', exact: true }).click()
  await dialog.getByRole('button', { name: '保存账号', exact: true }).click()
  await dialog.waitFor({ state: 'hidden', timeout: 20000 })
  assert.equal(await page.locator('input[type=password]').count(), 0, '向导关闭后应卸载秘密输入')
}

/** 验证独立账号页面与持久化元数据读取，取消不会创建账号。 */
export async function createAccountOnManagementPage(page, name, channel) {
  await page.getByRole('menuitem', { name: '商店账号', exact: true }).click()
  await page.getByRole('heading', { name: '商店账号', exact: true }).waitFor()
  await page.getByRole('button', { name: '新增商店账号', exact: true }).click()
  await fillCredentialWizard(page, name, channel)
  await page.getByRole('heading', { name, exact: true }).waitFor()
  await captureScreenshot(page, 'artifacts/credential-accounts-desktop.png')
  await page.getByRole('button', { name: '新增商店账号', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新增商店账号', exact: true })
  await dialog.getByLabel('账号名称', { exact: true }).fill('取消后不保存')
  await dialog.getByRole('button', { name: '下一步', exact: true }).click()
  await dialog.getByLabel('Client ID', { exact: true }).fill('synthetic-cancelled-value')
  await dialog.getByRole('button', { name: /取\s*消/ }).click()
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(await page.getByRole('heading', { name: '取消后不保存', exact: true }).count(), 0)
}
