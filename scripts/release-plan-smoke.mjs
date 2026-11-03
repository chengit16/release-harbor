/** @description 隔离浏览器验收发布计划；仅在测试临时目录注入明确的合成预检事实，不访问真实商店。 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { captureScreenshot } from './capture-screenshot.mjs'

/** 验证冻结、确认框关闭、限定确认、取消、配置失效与窄屏；生产服务没有测试开关。 */
export async function runReleasePlanSmoke(page, origin, dataRoot) {
  assert.ok(basename(dataRoot).startsWith('release-harbor-ui-'))
  const url = new URL(page.url())
  const root = `${origin}/api/projects/${url.searchParams.get('project')}/applications/${url.searchParams.get('application')}`
  // 1. 原预检失败测试已结束；写入独立合成事实仅供计划状态机验收，不能作为真实渠道证据。
  const file = join(dataRoot, 'preflights.json')
  const saved = JSON.parse(await readFile(file, 'utf8'))
  const original = saved.records.at(-1)
  assert.ok(original)
  const now = new Date().toISOString()
  saved.records.push({
    ...original,
    id: randomUUID(),
    status: 'passed',
    code: 'verified',
    artifact: 'passed',
    authentication: 'passed',
    target: 'passed',
    createdAt: now,
    checkedAt: now,
    expiresAt: new Date(Date.now() + 300000).toISOString(),
  })
  await writeFile(file + '.smoke.tmp', JSON.stringify(saved), { mode: 0o600 })
  await rename(file + '.smoke.tmp', file)
  const count = saved.records.length
  await page.getByRole('tab', { name: '发布计划', exact: true }).click()
  const panel = page.getByRole('region', { name: '发布计划', exact: true })
  const choice = panel.getByRole('combobox', { name: '用于冻结的预检', exact: true })
  await choice.click()
  await choice.press('ArrowDown')
  await choice.press('Enter')
  await panel
    .getByLabel('更新说明', { exact: true })
    .fill('合成计划验收：修复登录问题\n优化启动速度')
  await panel.getByRole('button', { name: '冻结计划并复核', exact: true }).click()
  const drawer = page.getByRole('dialog', { name: '发布计划复核', exact: true })
  await drawer.getByText('计划 SHA-256', { exact: true }).waitFor()
  let plans = (await (await fetch(root + '/release-plans')).json()).items
  assert.equal(plans.length, 1)
  assert.equal(plans[0].plan.authorization, null)
  assert.ok((await drawer.innerText()).includes(plans[0].plan.snapshot.releaseNotes))
  // 2. 关闭确认框不生成授权，必须明确勾选；完成后再确认取消撤销原授权。
  await drawer.getByRole('button', { name: '核对并确认', exact: true }).click()
  const modal = page.getByRole('dialog', { name: '确认本次发布范围', exact: true })
  assert.equal(
    await modal.getByRole('button', { name: '确认此计划', exact: true }).isEnabled(),
    false,
  )
  await modal.getByRole('button', { name: '返回复核', exact: true }).click()
  await modal.waitFor({ state: 'hidden' })
  assert.equal(
    (await (await fetch(root + '/release-plans')).json()).items[0].plan.authorization,
    null,
  )
  await drawer.getByRole('button', { name: '核对并确认', exact: true }).click()
  await modal.getByRole('checkbox').check()
  await modal.getByRole('button', { name: '确认此计划', exact: true }).click()
  await modal.waitFor({ state: 'hidden' })
  await drawer.getByText('已记录限定确认；执行能力待接入', { exact: true }).waitFor()
  plans = (await (await fetch(root + '/release-plans')).json()).items
  assert.equal(plans[0].plan.status, 'confirmed')
  assert.equal(plans[0].plan.authorization.scope, 'local_once')
  await page.setViewportSize({ width: 390, height: 844 })
  assert.ok(await drawer.evaluate((e) => e.scrollWidth <= e.clientWidth), '发布计划详情窄屏溢出')
  await page.screenshot({ path: 'artifacts/release-plan-detail-mobile.png' })
  await drawer.getByRole('button', { name: '取消计划', exact: true }).click()
  const pop = page.getByRole('tooltip').filter({ hasText: '取消这份发布计划' })
  await pop.getByRole('button', { name: '取消计划', exact: true }).click()
  await drawer.getByText('计划已取消，原确认不可使用', { exact: true }).waitFor()
  await drawer.getByRole('button', { name: '关闭计划详情', exact: true }).click()
  await drawer.waitFor({ state: 'hidden' })
  await page.reload()
  await page.getByRole('tab', { name: '发布计划', exact: true }).waitFor()
  assert.equal(
    await page.getByRole('tab', { name: '发布计划', exact: true }).getAttribute('aria-selected'),
    'true',
  )
  await panel.getByText('已取消', { exact: true }).waitFor()
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    '发布计划页面窄屏溢出',
  )
  await captureScreenshot(page, 'artifacts/release-plan-mobile.png')
  // 3. 新意图冻结后修改绑定，旧计划显示变化原因且不能继续确认。
  await page.setViewportSize({ width: 1440, height: 1000 })
  await choice.click()
  await choice.press('ArrowDown')
  await choice.press('Enter')
  await panel.getByLabel('更新说明', { exact: true }).fill('第二份合成计划：核对绑定变化')
  await panel.getByRole('button', { name: '冻结计划并复核', exact: true }).click()
  await drawer.getByText('计划 SHA-256', { exact: true }).waitFor()
  const binding = (await (await fetch(root + '/bindings')).json()).items[0]
  const changed = await fetch(root + '/bindings/' + binding.id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appId: binding.appId,
      credentialReference: binding.credentialReference,
      expectedRevision: binding.revision,
    }),
  })
  assert.equal(changed.status, 200)
  await drawer.getByRole('button', { name: '关闭计划详情', exact: true }).click()
  await drawer.waitFor({ state: 'hidden' })
  await panel.getByRole('button', { name: '重新读取计划与预检', exact: true }).click()
  await panel.getByText('已失效', { exact: true }).waitFor()
  await page
    .getByRole('region', { name: '计划历史', exact: true })
    .getByRole('button', { name: /复\s*核/, exact: true })
    .first()
    .click()
  await drawer.getByText('商店绑定已变化，请重新预检并冻结新计划', { exact: true }).waitFor()
  assert.equal(
    await drawer.getByRole('button', { name: '核对并确认', exact: true }).isEnabled(),
    false,
  )
  await drawer.getByRole('button', { name: '关闭计划详情', exact: true }).click()
  await drawer.waitFor({ state: 'hidden' })
  await captureScreenshot(page, 'artifacts/release-plan-desktop.png')
  assert.equal(
    (await (await fetch(root + '/preflights')).json()).items.length,
    count,
    '查看与确认不能触发新的预检',
  )
}
