/** @description 第三期荣耀状态观察的隔离浏览器验收，测试工作台返回合成审核结论，不连接商店。 */
import assert from 'node:assert/strict'
/** 查看历史与重载不发查询；唯一显式刷新产生观察，原执行记录保持不变。 */
export async function runReleaseObservationSmoke(page, origin) {
  const location = new URL(page.url()),
    root = `${origin}/api/projects/${location.searchParams.get('project')}/applications/${location.searchParams.get('application')}`
  const plans = (await (await fetch(root + '/release-plans')).json()).items
  const plan = plans[0].plan
  const before = await (await fetch(root + '/release-attempts')).text()
  let queries = 0
  const observer = (request) => {
    if (request.url().endsWith('/observations') && request.method() === 'POST') queries++
  }
  page.on('request', observer)
  location.searchParams.set('plan', plan.id)
  await page.goto(location.href)
  const summary = page.getByRole('dialog', { name: '发布摘要', exact: true })
  await summary.getByText('尚未查询本次版本的商店状态。', { exact: true }).waitFor()
  assert.equal(queries, 0)
  await summary.getByRole('button', { name: '查询荣耀状态', exact: true }).click()
  await summary.getByText('审核未通过', { exact: true }).waitFor()
  await summary.getByText(/请到荣耀开发者后台查看具体审核意见/).waitFor()
  await summary.getByText(/查询时间：.*非实时/).waitFor()
  assert.equal(queries, 1)
  assert.ok(await summary.getByRole('button', { name: '查询荣耀状态', exact: true }).isDisabled())
  await page.reload()
  await summary.getByText('审核未通过', { exact: true }).waitFor()
  assert.equal(queries, 1)
  for (const width of [1440, 375, 844]) {
    await page.setViewportSize({ width, height: 844 })
    assert.ok(
      await summary.evaluate((element) => element.scrollWidth <= element.clientWidth),
      '状态观察抽屉窄屏溢出',
    )
    await summary.getByText('审核未通过', { exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: `artifacts/honor-observation-${width}.png`, fullPage: false })
  }
  assert.equal(await (await fetch(root + '/release-attempts')).text(), before)
  const path = `**/api/projects/${location.searchParams.get('project')}/applications/${location.searchParams.get('application')}/release-plans/${plan.id}/observations`
  await page.route(path, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ statusCode: 503, message: '合成观察档案读取失败' }),
    }),
  )
  await summary.getByRole('button', { name: '重读本机观察', exact: true }).click()
  await summary.getByRole('alert').filter({ hasText: '合成观察档案读取失败' }).waitFor()
  await page.unroute(path)
  await summary.getByRole('button', { name: '重读本机观察', exact: true }).click()
  await summary.getByText('审核未通过', { exact: true }).waitFor()
  assert.equal(queries, 1)
  await summary.getByRole('button', { name: '关闭发布摘要', exact: true }).click()
  await page.setViewportSize({ width: 1440, height: 1000 })
  page.off('request', observer)
}
