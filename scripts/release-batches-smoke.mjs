/** @description 多渠道批次真实浏览器验收；隔离合成账号、APK 与执行端口，验证一次确认、独立结果和刷新不重放。 */
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { syntheticApk } from '../tests/fixtures/apk.ts'
import { captureScreenshot } from './capture-screenshot.mjs'

/** 浏览器完成批次全流程；仅本脚本创建的临时应用参与，不使用真实凭据或商店。 */
export async function runReleaseBatchesSmoke(page, origin, dataRoot) {
  // 1. 复用前面浏览器创建的合成账号，为全新应用分配同一实际检查的 APK。
  const url = new URL(page.url()),
    project = url.searchParams.get('project')
  const base = `${origin}/api/projects/${project}/applications`
  const created = await fetch(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: '批次合成应用',
      platform: 'android',
      identifier: 'com.example.batch',
    }),
  })
  assert.equal(created.status, 201)
  const response = await created.json(),
    app = response.application ?? response,
    root = base + '/' + app.id
  const catalog = (await (await fetch(origin + '/api/credential-accounts')).json()).catalog
  for (const channel of ['huawei', 'meizu']) {
    const account = catalog.accounts.find((a) => a.channel === channel && a.configured)
    assert.ok(account)
    const binding = await fetch(root + '/bindings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        channel,
        appId: channel === 'huawei' ? '999998' : '123459',
        credentialReference: account.reference,
      }),
    })
    assert.equal(binding.status, 201)
  }
  const apk = await syntheticApk(dataRoot, 'com.example.batch')
  assert.ok(apk)
  const uploaded = await fetch(root + '/artifacts', {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      'x-artifact-name': 'batch-synthetic.apk',
      'x-artifact-size': String(apk.length),
    },
    body: apk,
  })
  assert.equal(uploaded.status, 202)
  for (let n = 0; n < 100; n++) {
    if ((await (await fetch(root + '/artifacts')).json()).items[0]?.status === 'ready') break
    await delay(100)
  }
  url.searchParams.set('application', app.id)
  url.searchParams.set('tab', 'plans')
  url.searchParams.set('releaseView', 'batch')
  url.searchParams.delete('batch')
  await page.goto(url.href)
  const panel = page.getByRole('region', { name: '多渠道发布批次', exact: true })
  await panel.getByRole('checkbox', { name: '选择全部', exact: true }).check()
  assert.equal(await panel.getByRole('combobox', { name: '批次通用安装包' }).isVisible(), false)
  const common = panel.getByRole('button', { name: /批量设置/ })
  await common.focus()
  await common.press('Enter')
  const select = panel.getByRole('combobox', { name: '批次通用安装包', exact: true })
  await select.click()
  await select.press('ArrowDown')
  await select.press('Enter')
  await panel
    .getByRole('textbox', { name: '批次通用更新说明', exact: true })
    .fill('批次合成更新，优化用户体验')
  await captureScreenshot(page, 'artifacts/batch-common-settings-desktop.png')
  // 展开和收起只影响显示，未应用的输入与已选行都须保留。
  await common.click()
  await common.click()
  assert.equal(
    await panel.getByRole('textbox', { name: '批次通用更新说明' }).inputValue(),
    '批次合成更新，优化用户体验',
  )
  await panel.getByRole('button', { name: '应用到 2 个已选渠道', exact: true }).click()
  assert.equal(await select.isVisible(), false)
  assert.equal(await panel.getByRole('button', { name: '准备 2 个渠道', exact: true }).count(), 1)
  assert.equal(await panel.getByRole('table', { name: '批次历史' }).count(), 0)
  await panel.getByRole('button', { name: '编辑魅族发布内容', exact: true }).click()
  const editor = page.getByRole('dialog', { name: '编辑魅族发布内容', exact: true })
  assert.equal(await editor.getByLabel('本渠道更新说明').inputValue(), '批次合成更新，优化用户体验')
  await editor.getByLabel('本渠道更新说明').fill('关闭不覆盖已应用内容')
  await editor.getByRole('button', { name: /取\s*消/ }).click()
  await panel.getByRole('button', { name: '编辑魅族发布内容', exact: true }).click()
  assert.equal(await editor.getByLabel('本渠道更新说明').inputValue(), '批次合成更新，优化用户体验')
  await editor.getByRole('button', { name: /取\s*消/ }).click()
  await captureScreenshot(page, 'artifacts/batch-config-desktop.png')
  await page.setViewportSize({ width: 390, height: 844 })
  await panel.getByRole('checkbox', { name: '华为 AppGallery', exact: true }).waitFor()
  await common.click()
  await page.waitForFunction(() => document.documentElement.scrollWidth <= window.innerWidth)
  await captureScreenshot(page, 'artifacts/batch-common-settings-mobile.png')
  await common.click()
  await page.waitForFunction(() => document.documentElement.scrollWidth <= window.innerWidth)
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    '批次配置移动端溢出',
  )
  await captureScreenshot(page, 'artifacts/batch-config-mobile.png')
  await page.setViewportSize({ width: 1440, height: 1000 })
  // 2. 准备中刷新只读原进度，关闭摘要无授权；原始子计划始终 frozen。
  await panel.getByRole('button', { name: '准备 2 个渠道', exact: true }).click()
  await page.waitForURL((u) => !!u.searchParams.get('batch'))
  await page.reload()
  await panel.getByText('已准备', { exact: false }).first().waitFor()
  await panel.getByRole('button', { name: '查看批次摘要', exact: true }).click()
  const summary = page.getByRole('dialog', { name: '批次发布摘要', exact: true })
  // 首次准备保留失败行，修正绑定后由用户明确生成新摘要，不自动排除失败渠道。
  await summary
    .getByText('准备未全部通过，请修正或明确移除失败行后重新准备', { exact: true })
    .waitFor()
  await summary.getByText('魅族', { exact: false }).first().waitFor()
  assert.equal((await (await fetch(root + '/release-attempts')).json()).items.length, 0)
  await summary.getByRole('button', { name: '关闭批次详情', exact: true }).click()
  const bindings = (await (await fetch(root + '/bindings')).json()).items
  const meizu = bindings.find((b) => b.channel === 'meizu')
  assert.ok(meizu)
  const fixed = await fetch(root + '/bindings/' + meizu.id, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      appId: '123458',
      credentialReference: meizu.credentialReference,
      expectedRevision: meizu.revision,
    }),
  })
  assert.equal(fixed.status, 200)
  await page.reload()
  await panel.getByRole('button', { name: '修正或重新准备', exact: true }).click()
  await panel.getByRole('button', { name: '准备 2 个渠道', exact: true }).click()
  await panel.getByRole('button', { name: '查看批次摘要', exact: true }).waitFor()
  // 自动打开只用于本次显式准备；刷新后也可由历史摘要查看。
  await summary.getByText('请核对全部渠道后确认一次', { exact: true }).waitFor()
  assert.ok(
    await summary.getByRole('button', { name: '确认执行 2 个渠道', exact: true }).isDisabled(),
  )
  await page.setViewportSize({ width: 390, height: 844 })
  assert.ok(await summary.evaluate((e) => e.scrollWidth <= e.clientWidth), '批次摘要移动端溢出')
  await captureScreenshot(page, 'artifacts/batch-summary-mobile.png')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await summary.getByRole('button', { name: '关闭批次详情', exact: true }).click()
  assert.equal((await (await fetch(root + '/release-attempts')).json()).items.length, 0)
  assert.ok(
    (await (await fetch(root + '/release-plans')).json()).items.every(
      (v) => v.plan.authorization === null,
    ),
  )
  await panel.getByRole('button', { name: '查看批次摘要', exact: true }).click()
  // 停止先于许可，当前及剩余项均不写入；补发产生新摘要及新的一次确认。
  await summary.getByRole('checkbox').check()
  await summary.getByRole('button', { name: '确认执行 2 个渠道', exact: true }).click()
  const stopped = page.getByRole('dialog', { name: '批次执行详情', exact: true })
  await stopped.getByRole('button', { name: '停止后续执行', exact: true }).click()
  await stopped.getByText('2 / 2 项已结束', { exact: true }).waitFor()
  assert.ok(
    (await (await fetch(root + '/release-attempts')).json()).items.every(
      (a) => a.remoteStartedAt === null,
    ),
  )
  await stopped.getByRole('button', { name: '关闭批次详情', exact: true }).click()
  await panel.getByRole('button', { name: '重新准备剩余项', exact: true }).click()
  await panel.getByRole('button', { name: '准备 2 个渠道', exact: true }).click()
  await summary.getByText('请核对全部渠道后确认一次', { exact: true }).waitFor()
  // 3. 一次确认独立回执，刷新不重放；剩余项不默认勾选成功或未知目标。
  await summary.getByRole('checkbox').focus()
  await summary.getByRole('checkbox').press('Space')
  await summary.getByRole('button', { name: '确认执行 2 个渠道', exact: true }).press('Enter')
  const results = page.getByRole('dialog', { name: '批次执行详情', exact: true })
  await results.getByText('2 / 2 项已结束', { exact: true }).waitFor()
  await captureScreenshot(page, 'artifacts/batch-results-desktop.png')
  await page.reload()
  await panel.getByRole('button', { name: '查看执行详情', exact: true }).click()
  await results.getByText('2 / 2 项已结束', { exact: true }).waitFor()
  const attempts = (await (await fetch(root + '/release-attempts')).json()).items
  assert.equal(attempts.length, 3)
  assert.equal(attempts.filter((a) => a.remoteStartedAt !== null).length, 2)
  assert.deepEqual(
    new Set(attempts.map((a) => a.status)),
    new Set(['interrupted', 'succeeded', 'needs_reconciliation']),
  )
  assert.ok(attempts.every((a) => a.origin))
  await results.getByRole('button', { name: '关闭批次详情', exact: true }).click()
  const history = panel.getByRole('button', { name: /^批次历史/ })
  assert.equal(await history.getAttribute('aria-expanded'), 'false')
  await history.focus()
  await history.press('Enter')
  await panel
    .getByRole('table', { name: '批次历史', exact: true })
    .getByRole('button', { name: '查看', exact: true })
    .click()
  await results.getByText('2 / 2 项已结束', { exact: true }).waitFor()
  assert.equal(
    (await (await fetch(root + '/release-attempts')).json()).items.length,
    3,
    '查看历史不得新增执行',
  )
  await results.getByRole('button', { name: '关闭批次详情', exact: true }).click()
  await panel.getByRole('button', { name: '重新准备剩余项', exact: true }).click()
  assert.ok(await panel.getByRole('button', { name: '准备 0 个渠道', exact: true }).isDisabled())
}
