/** @description 独立商店查询浏览器验收；隔离绑定没有计划，合成官方响应不连接真实商店。 */
import assert from 'node:assert/strict'
import { captureScreenshot } from './capture-screenshot.mjs'

/** 官网版本不依赖本机发布；刷新、深链与前后退均不自动发起查询。 */
export async function runStoreStatusSmoke(page, origin) {
  const start = page.url(),
    url = new URL(start)
  const projectId = url.searchParams.get('project')
  const base = `${origin}/api/projects/${projectId}/applications`
  const created = await fetch(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: '官网发布应用',
      platform: 'android',
      identifier: 'com.example.external',
    }),
  })
  assert.equal(created.status, 201)
  const application = (await created.json()).application
  const bound = await fetch(`${base}/${application.id}/bindings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      channel: 'meizu',
      appId: '789012',
      credentialReference: 'synthetic-external-account',
    }),
  })
  assert.equal(bound.status, 201)
  const recordsBefore = await (await fetch(`${base}/${application.id}/release-plans`)).text()
  assert.equal(JSON.parse(recordsBefore).items.length, 0)
  let queries = 0
  const listener = (request) => {
    if (request.url().includes('/api/store-status/') && request.method() === 'POST') queries++
  }
  page.on('request', listener)
  url.search = new URLSearchParams({
    view: 'reviews',
    reviewProject: projectId,
    reviewApplication: application.id,
  }).toString()
  await page.goto(url.href)
  const region = page.getByRole('region', { name: '商店状态查询', exact: true })
  await region.getByText('找到 1 个商店绑定', { exact: true }).waitFor()
  assert.equal(queries, 0)
  await region.getByRole('button', { name: '查看详情', exact: true }).click()
  const detail = page.getByRole('dialog', { name: '商店状态详情', exact: true })
  await detail.getByText('尚未查询商店状态', { exact: true }).waitFor()
  await detail.getByRole('button', { name: '查询商店状态', exact: true }).click()
  await detail.getByText('3.0.0', { exact: true }).waitFor()
  await detail.getByText('审核中', { exact: true }).waitFor()
  await detail
    .getByText(/商店未提供构建号/)
    .last()
    .waitFor()
  assert.equal(queries, 1)
  await page.reload()
  await detail.getByText('3.0.0', { exact: true }).waitFor()
  for (const width of [1440, 375, 844]) {
    await page.setViewportSize({ width, height: 900 })
    assert.ok(
      await detail.evaluate((element) => element.scrollWidth <= element.clientWidth),
      '商店详情溢出',
    )
    await captureScreenshot(page, `artifacts/store-status-detail-${width}.png`)
  }
  await detail.getByRole('button', { name: '关闭商店详情', exact: true }).click()
  for (const width of [1440, 375, 844]) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      '商店目录横向溢出',
    )
    const heading = await page.getByRole('heading', { name: '审核状态', exact: true }).boundingBox()
    const content = await region.boundingBox()
    assert.ok(heading && content && Math.abs(heading.x - content.x) <= 2, '商店目录未与标题对齐')
    await captureScreenshot(page, `artifacts/store-status-list-${width}.png`)
  }
  await page.goBack()
  await detail.getByText('3.0.0', { exact: true }).waitFor()
  await page.goForward()
  await region.getByText('找到 1 个商店绑定', { exact: true }).waitFor()
  assert.equal(queries, 1)
  assert.equal(await (await fetch(`${base}/${application.id}/release-plans`)).text(), recordsBefore)
  // 目录传输失败不能显示成没有绑定；恢复只重读缓存，不重发商店请求。
  await page.route('**/api/store-status', (route) =>
    route.fulfill({ status: 503, json: { message: '合成目录读取失败' } }),
  )
  await page.reload()
  await region.getByText('商店目录读取失败', { exact: true }).waitFor()
  assert.equal(await region.getByText('找到 0 个商店绑定', { exact: true }).count(), 0)
  await page.unroute('**/api/store-status')
  await region.getByRole('button', { name: '刷新商店目录', exact: true }).click()
  await region.getByText('找到 1 个商店绑定', { exact: true }).waitFor()
  assert.equal(queries, 1)
  page.off('request', listener)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(start)
}
