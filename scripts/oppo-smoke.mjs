/** @description OPPO 页面隔离验收，验证实际账号向导、包名绑定、APK 检查、准备和单次确认，不连接商店。 */
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { syntheticApk } from '../tests/fixtures/apk.ts'
import { captureScreenshot } from './capture-screenshot.mjs'
import { openReleasePlanWorkspace } from './release-center-smoke.mjs'

/** 长函数保留原因：以一次用户流程保护跨页面材料边界和刷新行为，所有写入仅在隔离测试实例。 */
export async function runOppoSmoke(page, origin, dataRoot) {
  // 1. 新增账号采用独立配置通道，绑定包名自动填写且保持只读。
  const url = new URL(page.url()),
    project = url.searchParams.get('project')
  const base = `${origin}/api/projects/${project}/applications`
  const created = await fetch(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'OPPO 合成应用',
      platform: 'android',
      identifier: 'com.example.oppo',
    }),
  })
  assert.equal(created.status, 201)
  const response = await created.json(),
    application = response.application ?? response
  const root = base + '/' + application.id
  url.searchParams.set('application', application.id)
  url.searchParams.set('tab', 'bindings')
  await page.goto(url.href)
  await page.getByRole('button', { name: '添加商店绑定', exact: true }).click()
  const channel = page.getByRole('combobox', { name: '绑定商店渠道', exact: true })
  await channel.click()
  await page.locator('.ant-select-dropdown:visible').getByText('OPPO', { exact: true }).click()
  assert.equal(
    await page.getByLabel('OPPO目标包名', { exact: true }).inputValue(),
    'com.example.oppo',
  )
  await page.getByRole('button', { name: '新增账号', exact: true }).click()
  const wizard = page.getByRole('dialog', { name: '新增商店账号', exact: true })
  await wizard.getByLabel('账号名称', { exact: true }).fill('OPPO 浏览器合成账号')
  await wizard.getByRole('button', { name: '下一步', exact: true }).click()
  const secret = 'o'.repeat(64),
    leaks = []
  const observer = (request) => {
    if ((request.postData() ?? '').includes(secret)) {
      const target = new URL(request.url())
      if (
        target.hostname !== '127.0.0.1' ||
        !/^\/v1\/sessions\/[^/]+\/profile$/.test(target.pathname)
      )
        leaks.push(target.pathname)
    }
  }
  page.on('request', observer)
  await wizard.getByLabel('Client ID', { exact: true }).fill('synthetic-client-id')
  await wizard.getByLabel('Client Secret', { exact: true }).fill(secret)
  await page.setViewportSize({ width: 390, height: 844 })
  assert.ok(await wizard.evaluate((e) => e.scrollWidth <= e.clientWidth))
  await captureScreenshot(page, 'artifacts/oppo-account-mobile.png')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await wizard.getByRole('button', { name: '下一步', exact: true }).click()
  await wizard.getByRole('button', { name: '保存账号', exact: true }).click()
  await wizard.waitFor({ state: 'hidden', timeout: 20000 })
  await page.getByRole('button', { name: '保存绑定', exact: true }).click()
  const apk = await syntheticApk(dataRoot, 'com.example.oppo')
  assert.ok(apk)
  const received = await fetch(root + '/artifacts', {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      'x-artifact-name': 'oppo-synthetic.apk',
      'x-artifact-size': String(apk.length),
    },
    body: apk,
  })
  assert.equal(received.status, 202)
  for (let n = 0; n < 100; n++) {
    if ((await (await fetch(root + '/artifacts')).json()).items[0]?.status === 'ready') break
    await delay(100)
  }
  // 2. 公开资料自动复用，准备与关闭摘要都不能产生授权或执行。
  await openReleasePlanWorkspace(page)
  const panel = page.getByRole('region', { name: '发布计划', exact: true })
  for (const label of ['发布渠道', '发布安装包']) {
    const select = panel.getByRole('combobox', { name: label, exact: true })
    await select.click()
    await select.press('ArrowDown')
    await select.press('Enter')
  }
  await panel.getByLabel('更新说明', { exact: true }).fill('OPPO 合成版本更新内容')
  await panel.getByRole('radio', { name: '审核通过后立即上架', exact: true }).check()
  await panel.getByRole('button', { name: '准备发布', exact: true }).click()
  const summary = page.getByRole('dialog', { name: '发布摘要', exact: true })
  await summary.getByText(/自动复用 OPPO 普通应用版本/).waitFor()
  await summary.getByText(/异步任务/).waitFor()
  assert.ok(!(await summary.innerText()).includes(secret))
  assert.ok(await summary.getByRole('button', { name: '确认提交审核', exact: true }).isDisabled())
  await summary.getByRole('button', { name: '关闭发布摘要', exact: true }).click()
  assert.equal((await (await fetch(root + '/release-attempts')).json()).items.length, 0)
  const plans = (await (await fetch(root + '/release-plans')).json()).items
  assert.equal(plans[0].plan.authorization, null)
  await panel.getByRole('button', { name: '查看发布摘要', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  assert.ok(await summary.evaluate((e) => e.scrollWidth <= e.clientWidth))
  await captureScreenshot(page, 'artifacts/oppo-summary-mobile.png')
  await page.setViewportSize({ width: 1440, height: 1000 })
  // 3. 一次确认后展示平台版本处理事实，刷新不派发，成功不声称审核通过或已上架。
  await summary.getByRole('checkbox').check()
  await summary.getByRole('button', { name: '确认提交审核', exact: true }).click()
  await summary.waitFor({ state: 'hidden' })
  await page
    .getByRole('region', { name: '执行记录', exact: true })
    .getByText('版本处理成功', { exact: true })
    .waitFor()
  await page.reload()
  await page
    .getByRole('region', { name: '计划历史', exact: true })
    .getByText('版本处理成功', { exact: true })
    .waitFor()
  const attempts = (await (await fetch(root + '/release-attempts')).json()).items
  assert.equal(attempts.length, 1)
  assert.equal(attempts[0].code, 'oppo_version_processed')
  assert.deepEqual(leaks, [])
  assert.ok(
    await page.evaluate(
      (value) =>
        ![...Object.values(localStorage), ...Object.values(sessionStorage), location.href].some(
          (x) => x.includes(value),
        ),
      secret,
    ),
  )
  page.off('request', observer)
}
