/** @description 查询历史浏览器验收；真实缓存只读核对后，用合成目录覆盖变化场景，不请求真实商店。 */
import { openWorkbenchPage } from './navigation-state.mjs'
import assert from 'node:assert/strict'
import { captureScreenshot } from './capture-screenshot.mjs'

/** 验证留存刷新、变化标签、失败隔离与跨页基线，所有浏览动作均零商店查询。 */
export async function runStoreQueryHistorySmoke(page, origin, projectId, application, bindingId) {
  // 1. 前一步显式合成查询已持久保存，刷新必须保留同一历史且不重新查商店。
  const url = `${origin}/?${new URLSearchParams({ view: 'reviews', reviewProject: projectId, reviewApplication: application.id, reviewTarget: bindingId })}`
  let writes = 0
  const listener = (r) => {
    if (r.method() !== 'GET' && r.url().startsWith(`${origin}/api/`)) writes++
  }
  page.on('request', listener)
  await openWorkbenchPage(page, url)
  const detail = page.getByRole('dialog', { name: '商店状态详情', exact: true })
  const history = detail.getByRole('region', { name: '查询与变化记录', exact: true })
  await history.getByText('查询与变化记录（1）', { exact: true }).click()
  await history.getByText('读取成功', { exact: true }).waitFor()
  await page.reload()
  await history.getByText('查询与变化记录（1）', { exact: true }).waitFor()
  const response = await (await fetch(`${origin}/api/store-status`)).json()
  const stored = response.queryHistory.filter((item) => item.bindingId === bindingId)
  assert.equal(stored.length, 1)
  const first = stored[0]
  // 2. 合成七次历史模拟在审到上架与查询失败，覆盖分页后的比较，服务器原缓存不修改。
  const states = ['unknown', 'published', 'approved', 'approved', 'rejected', 'in_review', 'draft']
  const synthetic = states.map((state, i) => ({
    ...first,
    checkedAt: new Date(Date.UTC(2026, 10, 7, 10 - i)).toISOString(),
    code: i === 0 ? 'network' : 'observed',
    versions: i === 0 ? [] : [{ ...first.versions[0], state }],
  }))
  await page.route('**/api/store-status', async (route) => {
    await route.fulfill({
      json: {
        ...response,
        queryHistory: [
          ...response.queryHistory.filter((item) => item.bindingId !== bindingId),
          ...synthetic,
        ],
      },
    })
  })
  await page.reload()
  await history.getByText('查询与变化记录（7）', { exact: true }).click()
  await history.getByText(/未据此产生状态变化/).waitFor()
  await history.getByText(/未发现可确认的状态变化/).waitFor()
  await history.getByText('查看读取差异（1）', { exact: true }).first().click()
  await history.getByText('状态不同', { exact: true }).waitFor()
  await history.locator('.store-version-status-tag').filter({ hasText: '审核通过' }).waitFor()
  await history.locator('.store-version-status-tag').filter({ hasText: '已上架' }).waitFor()
  // 3. 手机及横屏正文必须完整可读；查看历史、展开、分页与刷新不发送业务写请求。
  for (const width of [1440, 375, 844]) {
    await page.setViewportSize({ width, height: 1000 })
    await history.scrollIntoViewIfNeeded()
    assert.ok(await detail.evaluate((el) => el.scrollWidth <= el.clientWidth), '查询历史详情溢出')
    assert.ok(
      await history
        .locator('.store-query-history-content')
        .evaluateAll((elements) => elements.every((el) => el.getBoundingClientRect().width >= 200)),
      '查询历史正文过窄',
    )
    await captureScreenshot(page, `artifacts/store-query-history-${width}.png`)
  }
  await history.getByTitle('2', { exact: true }).click()
  await history.getByText('首次留存的同范围成功结果，不推断此前状态。', { exact: true }).waitFor()
  await history.getByText('查看读取差异（1）', { exact: true }).first().click()
  await history.getByText('状态不同', { exact: true }).waitFor()
  await history.locator('.store-version-status-tag').filter({ hasText: '草稿' }).waitFor()
  await history.locator('.store-version-status-tag').filter({ hasText: '审核中' }).waitFor()
  await page.unroute('**/api/store-status')
  await page.reload()
  await history.getByText('查询与变化记录（1）', { exact: true }).waitFor()
  assert.equal(writes, 0)
  page.off('request', listener)
  await page.setViewportSize({ width: 1440, height: 1000 })
}
