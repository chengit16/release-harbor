/** @description 页面账号配置的合成浏览器流程，仅配合显式内存安全库夹具，不访问真实 Keychain。 */
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { captureScreenshot } from './capture-screenshot.mjs'

/** 调用方已打开向导；锁定渠道与自由选择均支持，不通过 API 偷填秘密。 */
export async function fillCredentialWizard(page, name, channel, title = '新增商店账号') {
  const dialog = page.getByRole('dialog', { name: title, exact: true })
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
  await page
    .getByRole('region', { name: '商店账号管理', exact: true })
    .getByRole('button', { name: '新增商店账号', exact: true })
    .waitFor()
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

/** 维护入口的实际点击闭环，确认取消、名称编辑、原引用替换和删除均不借用普通 API 注入材料。 */
export async function runAccountManagementSmoke(page, origin) {
  await page.getByRole('menuitem', { name: '商店账号', exact: true }).click()
  // 1. 复现没有材料的待核对卡片，再从页面更新凭据修复。
  await page.getByRole('button', { name: '管理账号 待核对验收账号', exact: true }).click()
  const pending = page.getByRole('dialog', { name: '账号维护', exact: true })
  await pending.getByRole('button', { name: '检查本机材料', exact: true }).click()
  await pending.getByRole('status').filter({ hasText: '未能核对完整材料' }).waitFor()
  await pending.getByRole('button', { name: '更新凭据', exact: true }).click()
  await fillCredentialWizard(page, '维护验收账号', 'huawei', '更新凭据')
  let card = page.getByRole('dialog', { name: '账号维护', exact: true })
  await card.getByRole('button', { name: '检查本机材料', exact: true }).click()
  await card.getByRole('status').filter({ hasText: '本机材料核对通过' }).waitFor()
  // 2. 名称编辑与凭据替换保持原引用，材料更新必须改变预检版本。
  await card.getByRole('button', { name: '更多操作', exact: true }).click()
  await page.getByRole('menuitem', { name: '修改名称', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: '修改账号名称', exact: true })
  await dialog.getByLabel('账号名称', { exact: true }).fill('维护后账号')
  await dialog.getByRole('button', { name: '保存名称', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  card = page.getByRole('dialog', { name: '账号维护', exact: true })
  await card.getByText('维护后账号', { exact: true }).waitFor()
  const before = await (await fetch(origin + '/api/credential-accounts')).json()
  const original = before.catalog.accounts.find((a) => a.displayName === '维护后账号')
  assert.ok(original)
  await card.getByRole('button', { name: '更新凭据', exact: true }).click()
  await fillCredentialWizard(page, '维护后账号', 'huawei', '更新凭据')
  const after = await (await fetch(origin + '/api/credential-accounts')).json()
  const updated = after.catalog.accounts.find((a) => a.displayName === '维护后账号')
  assert.equal(updated.reference, original.reference)
  assert.notEqual(updated.revision, original.revision)
  // 3. 取消不删除，确认后持久移除；有关联应用时禁止确认。
  await card.getByRole('button', { name: '更多操作', exact: true }).click()
  await page.getByRole('menuitem', { name: '删除账号', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '删除商店账号', exact: true })
  await dialog.getByRole('button', { name: /取\s*消/ }).click()
  await dialog.waitFor({ state: 'hidden' })
  await card.getByText('维护后账号', { exact: true }).waitFor()
  await card.getByRole('button', { name: '关闭账号维护', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('combobox', { name: '账号渠道筛选', exact: true }).waitFor()
  await captureScreenshot(page, 'artifacts/credential-actions-mobile.png')
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: '管理账号 维护后账号', exact: true }).click()
  await card.getByRole('button', { name: '更多操作', exact: true }).click()
  await page.getByRole('menuitem', { name: '删除账号', exact: true }).click()
  await dialog.getByRole('button', { name: '确认删除', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  await page.getByRole('heading', { name: '维护后账号', exact: true }).waitFor({ state: 'hidden' })
  await page.reload()
  await page.getByRole('menuitem', { name: '商店账号', exact: true }).click()
  await page
    .getByRole('region', { name: '商店账号管理', exact: true })
    .getByRole('button', { name: '新增商店账号', exact: true })
    .waitFor()
  assert.equal(await page.getByRole('heading', { name: '维护后账号', exact: true }).count(), 0)
  // 关联中的账号只能提示改绑，界面确认按钮禁用；服务端另有直接请求拒绝测试。
  const bound = (
    await (await fetch(origin + '/api/credential-accounts')).json()
  ).catalog.accounts.find((a) => a.applicationCount > 0)
  assert.ok(bound)
  await page.getByRole('button', { name: `管理账号 ${bound.displayName}`, exact: true }).click()
  const boundCard = page.getByRole('dialog', { name: '账号维护', exact: true })
  await boundCard.getByRole('button', { name: '更多操作', exact: true }).click()
  await page.getByRole('menuitem', { name: '删除账号', exact: true }).click()
  await dialog.getByText(/仍关联/).waitFor()
  assert.ok(await dialog.getByRole('button', { name: '确认删除', exact: true }).isDisabled())
  await captureScreenshot(page, 'artifacts/credential-delete-guard.png')
  await dialog.getByRole('button', { name: /取\s*消/ }).click()
  await dialog.waitFor({ state: 'hidden' })
  await boundCard.getByRole('button', { name: '关闭账号维护', exact: true }).click()
}
