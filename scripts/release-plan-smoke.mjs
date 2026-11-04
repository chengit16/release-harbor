/** @description 隔离 Chrome 验证自动准备与一次确认；合成端口和材料不构成真实商店证据。 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { syntheticApk } from '../tests/fixtures/apk.ts'
import { captureScreenshot } from './capture-screenshot.mjs'

/** 旧计划仍能查看和取消，暂缓的 Apple 不能因共用摘要入口被执行。 */
export async function runReleasePlanSmoke(page, origin, dataRoot) {
  assert.ok(basename(dataRoot).startsWith('release-harbor-ui-'))
  const url = new URL(page.url())
  const root = `${origin}/api/projects/${url.searchParams.get('project')}/applications/${url.searchParams.get('application')}`
  const file = join(dataRoot, 'preflights.json')
  const saved = JSON.parse(await readFile(file, 'utf8'))
  const original = saved.records.at(-1)
  const time = new Date().toISOString()
  const record = {
    ...original,
    id: randomUUID(),
    status: 'passed',
    code: 'verified',
    artifact: 'passed',
    authentication: 'passed',
    target: 'passed',
    createdAt: time,
    checkedAt: time,
    expiresAt: new Date(Date.now() + 300000).toISOString(),
  }
  saved.records.push(record)
  await writeFile(file + '.smoke.tmp', JSON.stringify(saved), { mode: 0o600 })
  await rename(file + '.smoke.tmp', file)
  const created = await fetch(root + '/release-plans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, 'X-Release-Harbor-Plan': '1' },
    body: JSON.stringify({
      requestId: randomUUID(),
      preflightId: record.id,
      action: 'apple_upload_build',
      releaseNotes: '历史 Apple 合成摘要',
    }),
  })
  assert.equal(created.status, 201)
  await page.getByRole('tab', { name: '发布计划', exact: true }).click()
  const iosPanel = page.getByRole('region', { name: '发布计划', exact: true })
  await iosPanel.getByRole('radio', { name: '审核通过后立即上架', exact: true }).waitFor()
  await iosPanel.getByRole('radio', { name: '指定时间上架', exact: true }).check()
  await iosPanel.getByRole('textbox', { name: '指定上架时间', exact: true }).waitFor()
  await iosPanel.getByRole('radio', { name: '审核通过后立即上架', exact: true }).check()
  const history = page.getByRole('region', { name: '计划历史', exact: true })
  await history
    .getByRole('button', { name: /查\s*看/, exact: true })
    .first()
    .click()
  const summary = page.getByRole('dialog', { name: '发布摘要', exact: true })
  await summary.getByText('该渠道执行暂未开放', { exact: true }).waitFor()
  assert.equal(
    await summary.getByRole('button', { name: '确认保存草稿', exact: true }).isEnabled(),
    false,
  )
  await page.setViewportSize({ width: 390, height: 844 })
  assert.ok(await summary.evaluate((e) => e.scrollWidth <= e.clientWidth), '摘要窄屏溢出')
  await summary.getByRole('button', { name: '取消本次发布', exact: true }).click()
  await page
    .getByRole('tooltip')
    .filter({ hasText: '取消本次发布？' })
    .getByRole('button', { name: '取消发布', exact: true })
    .click()
  await summary.getByText('计划已取消，原确认不可使用', { exact: true }).waitFor()
  await summary.getByRole('button', { name: '关闭发布摘要', exact: true }).click()
  await summary.waitFor({ state: 'hidden' })
  await captureScreenshot(page, 'artifacts/release-plan-mobile.png')
  await page.setViewportSize({ width: 1440, height: 1000 })
}

/** 同一页面完成准备、一次明确执行及人工核对；只有夹具合成目标返回替身通过。 */
export async function runExecutionSmoke(page, origin, dataRoot) {
  const url = new URL(page.url())
  const base = `${origin}/api/projects/${url.searchParams.get('project')}/applications`
  const created = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: '合成执行验收',
      platform: 'android',
      identifier: 'com.example.android',
    }),
  })
  const raw = await created.json()
  const application = raw.application ?? raw
  assert.ok(application.id)
  const existing = (await (await fetch(base)).json()).items.find((a) => a.name === '验收 Android')
  const binding = (await (await fetch(base + '/' + existing.id + '/bindings')).json()).items[0]
  const root = base + '/' + application.id
  assert.equal(
    (
      await fetch(root + '/bindings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'huawei',
          appId: '999999',
          credentialReference: binding.credentialReference,
        }),
      })
    ).status,
    201,
  )
  const apk = await syntheticApk(dataRoot)
  assert.ok(apk, '本机需要 aapt2')
  const received = await fetch(root + '/artifacts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Artifact-Name': 'synthetic.apk',
      'X-Artifact-Size': String(apk.length),
    },
    body: apk,
  })
  assert.equal(received.status, 202)
  for (let n = 0; n < 100; n++) {
    if ((await (await fetch(root + '/artifacts')).json()).items[0]?.status === 'ready') break
    await delay(100)
  }
  url.searchParams.set('application', application.id)
  url.searchParams.set('tab', 'plans')
  await page.goto(url.href)
  const panel = page.getByRole('region', { name: '发布计划', exact: true })
  const select = async (name) => {
    const field = panel.getByRole('combobox', { name, exact: true })
    await field.click()
    await field.press('ArrowDown')
    await field.press('Enter')
  }
  await select('发布渠道')
  await select('发布安装包')
  await panel.getByLabel('更新说明', { exact: true }).fill('合成自动准备与一次确认验收')
  const accepted = page.waitForResponse(
    (r) => r.url() === root + '/release-preparations' && r.request().method() === 'POST',
  )
  await panel.getByRole('button', { name: '准备发布', exact: true }).click()
  assert.equal((await accepted).status(), 202)
  // 1. 刷新只读原进度，不能新发预检；准备通过仍无授权或执行。
  await page.reload()
  await panel.getByText('检查通过，请核对发布摘要后确认', { exact: true }).waitFor()
  await panel.getByRole('button', { name: '查看发布摘要', exact: true }).click()
  const summary = page.getByRole('dialog', { name: '发布摘要', exact: true })
  assert.equal(
    await summary.getByRole('button', { name: '确认保存草稿', exact: true }).isEnabled(),
    false,
  )
  const plans = (await (await fetch(root + '/release-plans')).json()).items
  assert.equal(plans.length, 1)
  assert.equal(plans[0].plan.authorization, null)
  await captureScreenshot(page, 'artifacts/release-summary-desktop.png')
  await page.setViewportSize({ width: 390, height: 844 })
  assert.ok(await summary.evaluate((e) => e.scrollWidth <= e.clientWidth), '华为发布摘要窄屏溢出')
  await captureScreenshot(page, 'artifacts/release-summary-mobile.png')
  await page.setViewportSize({ width: 1440, height: 1000 })
  assert.equal((await (await fetch(root + '/preflights')).json()).items.length, 1)
  await summary.getByRole('button', { name: '关闭发布摘要', exact: true }).click()
  await summary.waitFor({ state: 'hidden' })
  assert.equal((await (await fetch(root + '/release-attempts')).json()).items.length, 0)
  // 2. 不再弹出第二个确认框；暂时失败保留勾选，显式再次提交仍是同一摘要。
  await panel.getByRole('button', { name: '查看发布摘要', exact: true }).click()
  await summary.getByRole('checkbox').check()
  await page.route(
    root + '/release-plans/*/confirm-and-execute',
    (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ statusCode: 503, message: '合成执行入口暂不可用' }),
      }),
    { times: 1 },
  )
  await summary.getByRole('button', { name: '确认保存草稿', exact: true }).click()
  await summary.getByRole('alert').filter({ hasText: '合成执行入口暂不可用' }).waitFor()
  assert.equal(await summary.getByRole('checkbox').isChecked(), true)
  await summary.getByRole('button', { name: '确认保存草稿', exact: true }).click()
  await summary.waitFor({ state: 'hidden' })
  const receipts = page.getByRole('region', { name: '执行记录', exact: true })
  await receipts.getByText(/远端结果待核对/).waitFor()
  const plansList = page.getByRole('region', { name: '计划历史', exact: true })
  await plansList.getByText('待核对', { exact: true }).waitFor()
  await plansList.getByText(/上传请求或等待回执超时/).waitFor()
  assert.equal(await plansList.getByText('授权已消费', { exact: true }).count(), 0)
  assert.equal((await (await fetch(root + '/release-attempts')).json()).items.length, 1)
  await captureScreenshot(page, 'artifacts/release-preparation-desktop.png')
  // 3. 原人工核对仍可用，结论不创建新任务或覆盖原始结果。
  await receipts.getByRole('button', { name: /详\s*情/, exact: true }).click()
  const detail = page.getByRole('dialog', { name: '执行记录详情', exact: true })
  await detail.getByText(/上传请求或等待回执超时/).waitFor()
  await detail.getByRole('button', { name: '记录人工核对', exact: true }).click()
  const reconcile = page.getByRole('dialog', { name: '记录人工核对结果', exact: true })
  await reconcile.getByRole('radio', { name: '仍不确定，继续保留阻塞', exact: true }).check()
  await reconcile.getByRole('checkbox').check()
  assert.equal(
    await reconcile.getByRole('button', { name: '保存核对结论', exact: true }).isEnabled(),
    false,
  )
  await reconcile.getByRole('button', { name: '暂不处理', exact: true }).click()
  await reconcile.waitFor({ state: 'hidden' })
  assert.equal(
    (await (await fetch(root + '/release-attempts')).json()).items[0].reconciliation,
    undefined,
  )
  await detail.getByRole('button', { name: '记录人工核对', exact: true }).click()
  await reconcile
    .getByRole('radio', { name: '未保存，并确认没有处理中上传任务', exact: true })
    .check()
  await reconcile.getByLabel('已核对的版本号', { exact: true }).fill('0.1.0')
  await reconcile.getByLabel('已核对的构建号', { exact: true }).fill('7')
  await reconcile.getByRole('checkbox').check()
  await reconcile.getByRole('button', { name: '保存核对结论', exact: true }).click()
  await reconcile.waitFor({ state: 'hidden' })
  await detail.getByText('用户人工核对结果', { exact: true }).waitFor()
  await page.setViewportSize({ width: 390, height: 844 })
  assert.ok(await detail.evaluate((e) => e.scrollWidth <= e.clientWidth), '执行详情窄屏溢出')
  await detail.getByRole('button', { name: '关闭执行详情', exact: true }).click()
  await detail.waitFor({ state: 'hidden' })
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    '准备页窄屏溢出',
  )
  await captureScreenshot(page, 'artifacts/release-preparation-mobile.png')
  await page.reload()
  await receipts.getByText('用户已核对', { exact: true }).waitFor()
  const history = (await (await fetch(root + '/release-attempts')).json()).items
  assert.equal(history.length, 1)
  assert.equal(history[0].status, 'needs_reconciliation')
  assert.equal(
    (await (await fetch(root + '/preflights')).json()).items.length,
    1,
    '刷新不能重放预检',
  )
  await page.setViewportSize({ width: 1440, height: 1000 })
}
