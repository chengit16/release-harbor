/** @description 问题中心的真实浏览器验收；只读取隔离工作台，不请求商店或修改源档案。 */
import assert from 'node:assert/strict'
import { captureScreenshot } from './capture-screenshot.mjs'

/** 按实际查找流程验证 URL 定位、关联记录、证据、空结果与失败恢复。 */
export async function runIssuesSmoke(page, origin) {
  // 1. 菜单读取当前目录，统计和分页与实际资料一致。
  await page.getByRole('menuitem', { name: '问题与解决', exact: true }).click()
  await page.getByRole('heading', { name: '问题与解决', exact: true }).waitFor()
  const panel = page.getByRole('region', { name: '问题与解决', exact: true })
  const catalog = await (await fetch(origin + '/api/issues')).json()
  await panel.getByText(`找到 ${catalog.items.length} 条问题`, { exact: true }).waitFor()
  assert.equal(new URL(page.url()).searchParams.get('view'), 'issues')
  await captureScreenshot(page, 'artifacts/issues-desktop.png')
  await panel.getByTitle('下一页').click()
  assert.equal(new URL(page.url()).searchParams.get('issuePage'), '2')
  await page.reload()
  await panel.getByText(`找到 ${catalog.items.length} 条问题`, { exact: true }).waitFor()
  assert.equal(new URL(page.url()).searchParams.get('issuePage'), '2')
  // 2. 搜索重置分页，未知原因与相关修复分别展示，刷新和后退恢复原记录。
  const search = panel.getByRole('searchbox', { name: '搜索问题', exact: true })
  await search.fill('超时')
  await page.waitForURL(
    (url) => url.searchParams.get('issueQ') === '超时' && !url.searchParams.has('issuePage'),
  )
  assert.equal(new URL(page.url()).searchParams.has('issuePage'), false)
  await panel.getByRole('button', { name: '查看 RH-0015', exact: true }).click()
  const detail = page.getByRole('dialog', { name: '问题详情', exact: true })
  await detail.getByText('未知', { exact: true }).waitFor()
  await detail.getByText('仍待验证', { exact: true }).waitFor()
  await detail.getByRole('button', { name: 'RH-0014', exact: true }).click()
  await detail.getByText('上传异常被统一覆盖，无法看到具体原因', { exact: true }).waitFor()
  await page.goBack()
  await detail.getByText('未知', { exact: true }).waitFor()
  await page.reload()
  await detail.getByText('未知', { exact: true }).waitFor()
  await detail.getByText('代码提交与验收证据', { exact: true }).click()
  const href = await detail.getByRole('link').first().getAttribute('href')
  assert.ok(href?.startsWith('/api/issues/RH-0015/documents/'))
  const doc = await fetch(origin + href)
  assert.equal(doc.status, 200)
  assert.match(doc.headers.get('content-type'), /text\/plain/)
  await page.setViewportSize({ width: 390, height: 844 })
  assert.ok(await detail.evaluate((e) => e.scrollWidth <= e.clientWidth), '问题详情窄屏溢出')
  await captureScreenshot(page, 'artifacts/issues-detail-mobile.png')
  await detail.getByRole('button', { name: '关闭问题详情', exact: true }).click()
  await detail.waitFor({ state: 'hidden' })
  // 3. 组合筛选、清空与错误恢复不能被表现成同一种空状态。
  const select = panel.getByRole('combobox', { name: '问题状态', exact: true })
  await select.click()
  await page.locator('.ant-select-dropdown:visible').getByText('待定位', { exact: true }).click()
  await panel.getByText('找到 1 条问题', { exact: true }).waitFor()
  await panel.getByRole('button', { name: '清空筛选', exact: true }).click()
  await search.fill('没有匹配的合成检索词')
  await panel.getByText('没有匹配问题，请调整筛选条件', { exact: true }).waitFor()
  await panel.getByRole('button', { name: '清空筛选', exact: true }).click()
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    '问题列表窄屏溢出',
  )
  await captureScreenshot(page, 'artifacts/issues-mobile.png')
  await page.route(
    '**/api/issues',
    (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: '合成档案不可读' }),
      }),
    { times: 1 },
  )
  await panel.getByRole('button', { name: '重新读取档案', exact: true }).click()
  await panel.getByRole('alert').filter({ hasText: '合成档案不可读' }).waitFor()
  await panel.getByRole('button', { name: '重新读取档案', exact: true }).click()
  await panel.getByText(`找到 ${catalog.items.length} 条问题`, { exact: true }).waitFor()
  await page.setViewportSize({ width: 1440, height: 1000 })
}
