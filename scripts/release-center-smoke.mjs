/** @description 发布中心浏览器验收；使用本地合成应用验证筛选、导航和原发布工作区。 */
import { openWorkbenchPage, readNavigationUrl } from './navigation-state.mjs'
import assert from 'node:assert/strict'
import { captureScreenshot } from './capture-screenshot.mjs'

/** 通过页面入口发起后进入工作区，不提交准备、审核、上传或上线动作。 */
export async function runReleaseCenterSmoke(page) {
  await page.getByRole('button', { name: '前往发布中心', exact: true }).click()
  const center = page.getByRole('region', { name: '发布中心', exact: true })
  await center.getByRole('button', { name: '发起发布', exact: true }).waitFor()
  const url = await readNavigationUrl(page)
  assert.equal(url.searchParams.get('view'), 'releases')
  assert.ok(url.searchParams.get('releaseProject'))
  assert.ok(url.searchParams.get('releaseApplication'))
  await center.getByRole('button', { name: '发起发布', exact: true }).click()
  const modal = page.getByRole('dialog', { name: '发起发布', exact: true })
  await modal.getByRole('combobox', { name: '发布应用', exact: true }).waitFor()
  await modal.getByRole('button', { name: '开始配置', exact: true }).click()
  await page.getByRole('heading', { name: '验收 Android', exact: true }).waitFor()
  assert.equal((await readNavigationUrl(page)).searchParams.get('releaseTask'), 'workspace')
  await page.getByRole('button', { name: '管理应用配置', exact: true }).click()
  await page.getByRole('tab', { name: '渠道配置', exact: true }).waitFor()
}

/** 深链恢复已选应用的单渠道工作区，供既有隔离发布用例复用。 */
export async function openReleasePlanWorkspace(page) {
  const url = await readNavigationUrl(page)
  url.searchParams.set('view', 'releases')
  url.searchParams.set('releaseTask', 'workspace')
  url.searchParams.delete('tab')
  url.searchParams.delete('plan')
  url.searchParams.delete('batch')
  url.searchParams.delete('batchRevision')
  url.searchParams.delete('releaseView')
  url.searchParams.delete('releaseApple')
  url.searchParams.delete('appleRecord')
  url.searchParams.delete('releaseCompose')
  url.searchParams.delete('releaseSelected')
  await openWorkbenchPage(page, url.href)
  await page.getByRole('region', { name: '发布计划', exact: true }).waitFor()
}

/** 有历史后覆盖筛选、计划及批次深链、刷新、回退和失败恢复，所有读取都不得产生写入请求。 */
export async function runReleaseCenterHistorySmoke(page, origin) {
  const writes = []
  const observer = (request) => {
    if (request.url().startsWith(origin + '/api/') && request.method() !== 'GET')
      writes.push(request.method() + ' ' + new URL(request.url()).pathname)
  }
  page.on('request', observer)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('menuitem', { name: '发布中心', exact: true }).click()
  const center = page.getByRole('region', { name: '发布中心', exact: true })
  await center.getByRole('button', { name: '重置筛选', exact: true }).click()
  const response = await (await fetch(origin + '/api/release-center')).json()
  await center.getByText(`找到 ${response.items.length} 条发布记录`, { exact: true }).waitFor()
  assert.ok(response.items.some((item) => item.kind === 'plan'))
  assert.ok(response.items.some((item) => item.kind === 'batch'))
  const select = async (name, label) => {
    await center.getByRole('combobox', { name, exact: true }).click()
    await page.locator('.ant-select-dropdown:visible').getByText(label, { exact: true }).click()
  }
  // iOS 已有构建审核与手动发布各占一条；查看和刷新摘要不重复执行。
  await select('筛选发布方式', 'iOS 审核与发布')
  const apple = response.items.filter((item) => item.kind === 'apple')
  assert.equal(apple.length, 2)
  await center.getByText(`找到 ${apple.length} 条发布记录`, { exact: true }).waitFor()
  await center.getByText('iOS 提交审核', { exact: true }).waitFor()
  await center.getByText('iOS 手动发布', { exact: true }).waitFor()
  await center
    .getByText(/历史观察：.*非实时/)
    .first()
    .waitFor()
  for (const row of apple) {
    await center.getByRole('button', { name: `查看审核记录 ${row.id}`, exact: true }).click()
    const summary = page.getByRole('dialog', { name: 'Apple 发布摘要', exact: true })
    await summary.waitFor()
    await summary
      .getByText(row.action === 'submit' ? '提交审核' : '请求手动发布', { exact: true })
      .waitFor()
    assert.equal((await readNavigationUrl(page)).searchParams.get('appleRecord'), row.id)
    await page.reload()
    await summary.waitFor()
    await page.goBack()
    await center.getByText(`找到 ${apple.length} 条发布记录`, { exact: true }).waitFor()
    await page.goForward()
    await summary.waitFor()
    await summary.getByRole('button', { name: '关闭摘要', exact: true }).click()
    await page.getByRole('button', { name: '返回发布列表', exact: true }).click()
  }
  // 恢复错误和错误记录定位不能落到另一条审核记录或隐式查询商店。
  await center.getByRole('button', { name: `查看审核记录 ${apple[0].id}`, exact: true }).click()
  const appleUrl = (await readNavigationUrl(page)).href
  const base = new URL(appleUrl)
  const historyPath = `**/api/projects/${base.searchParams.get('project')}/applications/${base.searchParams.get('application')}/apple-review`
  await page.route(historyPath, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ statusCode: 503, message: '合成审核历史读取失败' }),
    }),
  )
  await page.reload()
  await page.getByRole('alert').filter({ hasText: '合成审核历史读取失败' }).waitFor()
  await page.unroute(historyPath)
  await page.getByRole('button', { name: '重新读取审核记录', exact: true }).click()
  const appleSummary = page.getByRole('dialog', { name: 'Apple 发布摘要', exact: true })
  await appleSummary.waitFor()
  await appleSummary.getByRole('button', { name: '关闭摘要', exact: true }).click()
  const missing = await readNavigationUrl(page)
  missing.searchParams.set('appleRecord', '00000000-0000-4000-8000-000000000000')
  await openWorkbenchPage(page, missing.href)
  await page.getByRole('alert').filter({ hasText: '当前应用下找不到该审核记录。' }).waitFor()
  assert.equal(await page.getByRole('dialog', { name: 'Apple 发布摘要', exact: true }).count(), 0)
  await page.getByRole('button', { name: '返回审核记录', exact: true }).click()
  await page.getByRole('button', { name: '返回发布列表', exact: true }).click()
  await center.getByRole('button', { name: '重置筛选', exact: true }).click()
  await select('筛选发布方式', '多渠道批次')
  const batches = response.items.filter((item) => item.kind === 'batch')
  await center.getByText(`找到 ${batches.length} 条发布记录`, { exact: true }).waitFor()
  await page.reload()
  assert.equal((await readNavigationUrl(page)).searchParams.get('releaseKind'), 'batch')
  await center.getByRole('button', { name: `查看批次 ${batches[0].id}`, exact: true }).click()
  const detail = page.getByRole('dialog', { name: '批次执行详情', exact: true })
  await detail.waitFor()
  await page.reload()
  await detail.waitFor()
  await page.goBack()
  await center.getByText(`找到 ${batches.length} 条发布记录`, { exact: true }).waitFor()
  await page.goForward()
  await detail.waitFor()
  await detail.getByRole('button', { name: '关闭批次详情', exact: true }).click()
  await page.getByRole('button', { name: '返回发布列表', exact: true }).click()
  await center.getByRole('button', { name: '重置筛选', exact: true }).click()
  await select('筛选渠道', '小米')
  const xiaomi = response.items.find(
    (item) => item.kind === 'plan' && item.channels.includes('xiaomi'),
  )
  assert.ok(xiaomi)
  await center.getByRole('button', { name: `查看计划 ${xiaomi.id}`, exact: true }).click()
  const planDetail = page.getByRole('dialog', { name: '发布摘要', exact: true })
  await planDetail.waitFor()
  await page.reload()
  await planDetail.waitFor()
  await planDetail.getByRole('button', { name: '关闭发布摘要', exact: true }).click()
  await page.getByRole('button', { name: '返回发布列表', exact: true }).click()
  assert.equal((await readNavigationUrl(page)).searchParams.get('releaseChannel'), 'xiaomi')
  await center.getByRole('button', { name: '重置筛选', exact: true }).click()
  await center.getByText(`找到 ${response.items.length} 条发布记录`, { exact: true }).waitFor()
  await captureScreenshot(page, 'artifacts/release-center-desktop.png')
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport)
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      '发布中心页面溢出',
    )
  }
  await page.setViewportSize({ width: 375, height: 812 })
  await captureScreenshot(page, 'artifacts/release-center-mobile.png')
  await page.route('**/api/release-center', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: '合成汇总读取失败', statusCode: 503 }),
    }),
  )
  await center.getByRole('button', { name: '刷新发布记录', exact: true }).click()
  await center.getByRole('alert').filter({ hasText: '合成汇总读取失败' }).waitFor()
  assert.equal(await center.getByRole('table').count(), 0)
  await page.unroute('**/api/release-center')
  await center.getByRole('button', { name: '重新读取', exact: true }).click()
  await center.getByText(`找到 ${response.items.length} 条发布记录`, { exact: true }).waitFor()
  assert.deepEqual(writes, [], '发布中心只读导航不得产生写入请求')
  page.off('request', observer)
}
