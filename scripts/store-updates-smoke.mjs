/** @description 魅族／荣耀页面隔离验收，验证实际账号向导、数字 App ID 绑定、APK 检查、准备和单次确认，不连接商店。 */
import { openWorkbenchPage, readNavigationUrl } from './navigation-state.mjs'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { syntheticApk } from '../tests/fixtures/apk.ts'
import { captureScreenshot } from './capture-screenshot.mjs'
import { openReleasePlanWorkspace } from './release-center-smoke.mjs'

/** 长函数保留原因：以一次用户流程保护跨页面材料边界和刷新行为，所有写入仅在隔离测试实例。 */
export async function runStoreUpdatesSmoke(page, origin, dataRoot, channel) {
  const label = channel === 'meizu' ? '魅族' : '荣耀'
  const identifier = `com.example.${channel}`
  // 1. 新增账号采用独立配置通道，明确填写数字 App ID，账号自动选中。
  const url = await readNavigationUrl(page),
    project = url.searchParams.get('project')
  const base = `${origin}/api/projects/${project}/applications`
  const created = await fetch(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: `${label} 合成应用`,
      platform: 'android',
      identifier,
    }),
  })
  assert.equal(created.status, 201)
  const response = await created.json(),
    application = response.application ?? response
  const root = base + '/' + application.id
  url.searchParams.set('application', application.id)
  url.searchParams.set('tab', 'bindings')
  await openWorkbenchPage(page, url.href)
  await page.getByRole('button', { name: '添加商店绑定', exact: true }).click()
  const channelSelect = page.getByRole('combobox', { name: '绑定商店渠道', exact: true })
  await channelSelect.click()
  await page.locator('.ant-select-dropdown:visible').getByText(label, { exact: true }).click()
  await page
    .getByLabel('商店 appId', { exact: true })
    .fill(channel === 'meizu' ? '123457' : '123456')
  await page.getByRole('button', { name: '新增账号', exact: true }).click()
  const wizard = page.getByRole('dialog', { name: '新增商店账号', exact: true })
  await wizard.getByLabel('账号名称', { exact: true }).fill(`${label} 浏览器合成账号`)
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
  await captureScreenshot(page, `artifacts/${channel}-account-mobile.png`)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await wizard.getByRole('button', { name: '下一步', exact: true }).click()
  await wizard.getByRole('button', { name: '保存账号', exact: true }).click()
  await wizard.waitFor({ state: 'hidden', timeout: 20000 })
  await page.getByRole('button', { name: '保存绑定', exact: true }).click()
  const apk = await syntheticApk(dataRoot, identifier)
  assert.ok(apk)
  const received = await fetch(root + '/artifacts', {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      'x-artifact-name': `${channel}-synthetic.apk`,
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
  await panel.getByLabel('更新说明', { exact: true }).fill(`${label} 合成版本更新内容`)
  let stamp
  const scheduled = panel.getByRole('radio', { name: '指定时间上架', exact: true })
  if (channel === 'meizu') {
    assert.ok(await scheduled.isDisabled())
    await panel.getByText(/公开 API 没有定时上架参数/).waitFor()
    await panel.getByRole('radio', { name: '审核通过后立即上架', exact: true }).check()
  } else {
    await scheduled.check()
    const schedule = panel.getByRole('textbox', { name: '指定上架时间', exact: true }),
      date = new Date(Date.now() + 86400000)
    stamp =
      [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
      ].join('-') + ' 18:30:00'
    await schedule.fill(stamp)
    await schedule.press('Enter')
  }
  assert.equal((await (await fetch(root + '/release-preparations')).json()).items.length, 0)
  if (channel === 'meizu') {
    // 历史版本推荐语为空必须直达具体补齐建议；失败不得创建计划或执行，修正后由用户显式重新准备。
    await panel.getByRole('button', { name: '准备发布', exact: true }).click()
    await panel.getByText(/魅族现有版本缺少必填“推荐语”/).waitFor()
    await panel.getByText(/本次准备未执行商店上传/).waitFor()
    assert.equal((await (await fetch(root + '/release-plans')).json()).items.length, 0)
    assert.equal((await (await fetch(root + '/release-attempts')).json()).items.length, 0)
    await captureScreenshot(page, 'artifacts/meizu-material-warning.png')
    const binding = (await (await fetch(root + '/bindings')).json()).items[0]
    const fixed = await fetch(root + '/bindings/' + binding.id, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        appId: '123456',
        credentialReference: binding.credentialReference,
        expectedRevision: binding.revision,
      }),
    })
    assert.equal(fixed.status, 200)
    await panel.getByRole('button', { name: '重新读取发布数据', exact: true }).click()
    await panel.getByText('魅族 · App ID 123456', { exact: true }).waitFor()
  }
  await captureScreenshot(page, `artifacts/${channel}-preparation-desktop.png`)
  await panel.getByRole('button', { name: '准备发布', exact: true }).click()
  const summary = page.getByRole('dialog', { name: '发布摘要', exact: true })
  await summary
    .getByRole('region', { name: '本次资料与策略范围', exact: true })
    .getByText('资料写入范围', { exact: true })
    .waitFor()
  await summary.getByText(channel === 'meizu' ? /沿用商店版本/ : /沿用构建号/).waitFor()
  await summary.getByText(/不代表审核通过或已上架/).waitFor()
  await summary
    .getByText(channel === 'honor' ? /本次提交将向荣耀发送上架选择/ : /魅族 API 未提供发布时间字段/)
    .waitFor()
  assert.ok(!(await summary.innerText()).includes(secret))
  assert.ok(await summary.getByRole('button', { name: '确认提交审核', exact: true }).isDisabled())
  await summary.getByRole('button', { name: '关闭发布摘要', exact: true }).click()
  assert.equal((await (await fetch(root + '/release-attempts')).json()).items.length, 0)
  const plans = (await (await fetch(root + '/release-plans')).json()).items
  assert.equal(plans[0].plan.authorization, null)
  assert.equal(
    plans[0].plan.snapshot.releasePolicy.mode,
    channel === 'meizu' ? 'after_approval' : 'scheduled',
  )
  if (stamp)
    assert.equal(
      new Date(plans[0].plan.snapshot.releasePolicy.notBefore).getTime(),
      new Date(stamp).getTime(),
    )
  await panel.getByRole('button', { name: '查看发布摘要', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  assert.ok(await summary.evaluate((e) => e.scrollWidth <= e.clientWidth))
  await captureScreenshot(page, `artifacts/${channel}-summary-mobile.png`)
  await page.setViewportSize({ width: 1440, height: 1000 })
  // 3. 一次确认后展示平台版本处理事实，刷新不派发，成功不声称审核通过或已上架。
  await summary.getByRole('checkbox').check()
  await summary.getByRole('button', { name: '确认提交审核', exact: true }).click()
  await summary.waitFor({ state: 'hidden' })
  await page
    .getByRole('region', { name: '执行记录', exact: true })
    .getByText('已提交审核', { exact: true })
    .waitFor()
  await page.reload()
  await page
    .getByRole('region', { name: '计划历史', exact: true })
    .getByText('已提交审核', { exact: true })
    .waitFor()
  const attempts = (await (await fetch(root + '/release-attempts')).json()).items
  assert.equal(attempts.length, 1)
  assert.equal(
    attempts[0].code,
    channel === 'meizu' ? 'meizu_review_submitted' : 'honor_review_submitted',
  )
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
