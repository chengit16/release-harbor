/** @description 审核状态独立菜单真实浏览器回归；合成记录与查询结果，不连接真实商店。 */
import assert from 'node:assert/strict'
import { captureScreenshot } from './capture-screenshot.mjs'

/** 从发布详情跳转后才显示查询面板；菜单、筛选、刷新与前后退均不重复查询或发布。 */
export async function runReleaseObservationSmoke(page, origin) {
  const startUrl = page.url(),
    location = new URL(startUrl)
  const root = `${origin}/api/projects/${location.searchParams.get('project')}/applications/${location.searchParams.get('application')}`
  const plan = (await (await fetch(root + '/release-plans')).json()).items[0].plan
  const before = await (await fetch(root + '/release-attempts')).text()
  let queries = 0
  const writes = []
  const observer = (request) => {
    if (request.url().startsWith(origin + '/api/') && request.method() !== 'GET')
      writes.push(new URL(request.url()).pathname)
    if (request.url().endsWith('/observations') && request.method() === 'POST') queries++
  }
  page.on('request', observer)
  // 1. 发布详情只保留跳转，禁止把新能力再次嵌回旧面板。
  location.searchParams.set('plan', plan.id)
  await page.goto(location.href)
  const summary = page.getByRole('dialog', { name: '发布摘要', exact: true })
  await summary.getByRole('button', { name: '查看审核状态', exact: true }).waitFor()
  assert.equal(await summary.getByRole('button', { name: '查询荣耀状态', exact: true }).count(), 0)
  await summary.getByRole('button', { name: '查看审核状态', exact: true }).click()
  const center = page.getByRole('region', { name: '审核状态', exact: true })
  const detail = page.getByRole('dialog', { name: '审核状态详情', exact: true })
  await page.getByRole('heading', { name: '审核状态', exact: true }).waitFor()
  await detail.getByText('尚未查询本次版本的商店状态。', { exact: true }).waitFor()
  assert.equal(new URL(page.url()).searchParams.get('view'), 'reviews')
  assert.equal(queries, 0)
  // 2. 唯一显式 POST 查询，旧回执保持原字节，刷新和前后退恢复同一记录。
  await detail.getByRole('button', { name: '查询荣耀状态', exact: true }).click()
  await detail.getByText('审核未通过', { exact: true }).waitFor()
  await detail.getByText(/请到荣耀开发者后台查看具体审核意见/).waitFor()
  await detail.getByText(/查询时间：.*非实时/).waitFor()
  assert.equal(queries, 1)
  assert.ok(await detail.getByRole('button', { name: '查询荣耀状态', exact: true }).isDisabled())
  await page.reload()
  await detail.getByText('审核未通过', { exact: true }).waitFor()
  await page.goBack()
  await summary.getByRole('button', { name: '查看审核状态', exact: true }).waitFor()
  assert.equal(await summary.getByRole('button', { name: '查询荣耀状态', exact: true }).count(), 0)
  await page.goForward()
  await detail.getByText('审核未通过', { exact: true }).waitFor()
  assert.equal(queries, 1)
  for (const width of [1440, 375, 844]) {
    await page.setViewportSize({ width, height: 844 })
    await detail.getByText('审核未通过', { exact: true }).scrollIntoViewIfNeeded()
    assert.ok(
      await detail.evaluate((element) => element.scrollWidth <= element.clientWidth),
      '审核状态详情窄屏溢出',
    )
    await page.screenshot({ path: `artifacts/honor-observation-${width}.png`, fullPage: false })
  }
  const path = `**/api/projects/${location.searchParams.get('project')}/applications/${location.searchParams.get('application')}/release-plans/${plan.id}/observations`
  await page.route(path, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ statusCode: 503, message: '合成观察档案读取失败' }),
    }),
  )
  await detail.getByRole('button', { name: '重读本机观察', exact: true }).click()
  await detail.getByRole('alert').filter({ hasText: '合成观察档案读取失败' }).waitFor()
  await page.unroute(path)
  await detail.getByRole('button', { name: '重读本机观察', exact: true }).click()
  await detail.getByText('审核未通过', { exact: true }).waitFor()
  await detail.getByRole('button', { name: '关闭审核详情', exact: true }).click()
  // 3. 列表状态随明确查询更新，菜单可直接访问，筛选刷新与异常恢复保留定位。
  await page.setViewportSize({ width: 1440, height: 1000 })
  await center.getByText('找到 1 条审核记录', { exact: true }).waitFor()
  await page.getByRole('menuitem', { name: '审核状态', exact: true }).click()
  await page.getByRole('tab', { name: '本地发布关联', exact: true }).click()
  await center.getByRole('combobox', { name: '审核筛选状态', exact: true }).click()
  await page
    .locator('.ant-select-dropdown:visible')
    .getByText('审核未通过', { exact: true })
    .click()
  await page.reload()
  await center.getByText('找到 1 条审核记录', { exact: true }).waitFor()
  assert.equal(new URL(page.url()).searchParams.get('reviewState'), 'rejected')
  await center.getByRole('button', { name: '重置审核筛选', exact: true }).click()
  const response = await (await fetch(origin + '/api/review-tracking')).json()
  await center.getByText(`找到 ${response.items.length} 条审核记录`, { exact: true }).waitFor()
  assert.ok(response.items.some((item) => item.kind === 'apple'))
  assert.ok(
    response.items.some((item) => item.channel === 'xiaomi' && item.state === 'not_queried'),
  )
  await center.getByText('官方未开放查询', { exact: true }).waitFor()
  await captureScreenshot(page, 'artifacts/review-tracking-desktop.png')
  // 合成超长名称只修改只读响应，保护窄屏卡片的换行边界，不改真实资料。
  const longName = '审核状态长应用名称ReleaseHarborVersionObservationLayoutBoundary'
  await page.route('**/api/review-tracking', async (route) => {
    const original = await route.fetch(),
      body = await original.json()
    for (const item of body.items) if (item.channel === 'honor') item.applicationName = longName
    await route.fulfill({ response: original, json: body })
  })
  await center.getByRole('button', { name: '刷新审核记录', exact: true }).click()
  await center.getByText(longName, { exact: true }).waitFor()
  for (const width of [375, 844]) {
    await page.setViewportSize({ width, height: 844 })
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
    const heading = await page.getByRole('heading', { name: '审核状态', exact: true }).boundingBox()
    const region = await center.boundingBox()
    assert.ok(heading && region && Math.abs(heading.x - region.x) <= 2, '审核状态内容未与标题对齐')
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      '审核状态页面横向溢出',
    )
  }
  await page.setViewportSize({ width: 375, height: 812 })
  await center.getByRole('list', { name: '审核记录列表', exact: true }).waitFor()
  await captureScreenshot(page, 'artifacts/review-tracking-mobile.png')
  await page.route('**/api/review-tracking', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ statusCode: 503, message: '合成审核汇总读取失败' }),
    }),
  )
  await center.getByRole('button', { name: '刷新审核记录', exact: true }).click()
  await center.getByRole('alert').filter({ hasText: '合成审核汇总读取失败' }).waitFor()
  assert.equal(await center.getByRole('table').count(), 0)
  assert.equal(await center.getByRole('list', { name: '审核记录列表', exact: true }).count(), 0)
  await page.unroute('**/api/review-tracking')
  await center.getByRole('button', { name: '重新读取审核记录', exact: true }).click()
  await center.getByText(`找到 ${response.items.length} 条审核记录`, { exact: true }).waitFor()
  assert.equal(queries, 1)
  assert.equal(writes.length, 1, '独立菜单只允许用户明确点击的那次只读查询，不得触发发布操作')
  assert.equal(await (await fetch(root + '/release-attempts')).text(), before)
  page.off('request', observer)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(startUrl)
}
