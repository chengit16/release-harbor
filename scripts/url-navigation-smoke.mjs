/** @description 隔离浏览器验证 URL 清理、旧链接、菜单与页签切换；观察窗口内禁止业务写请求。 */
import assert from 'node:assert/strict'
import { captureScreenshot } from './capture-screenshot.mjs'

async function checkChannelSummary(page, brands) {
  const summary = page
    .locator('span.ant-typography')
    .filter({ hasText: /^本次渠道：/ })
    .first()
  await summary.waitFor()
  assert.equal((await summary.innerText()).replace(/\s/g, ''), '本次渠道：' + brands.join('、'))
  assert.ok(
    await summary
      .locator('strong')
      .evaluate((element) => Number(getComputedStyle(element).fontWeight) >= 600),
  )
  return summary.locator('..')
}

/** 复用合成批次应用，核对刷新、深链、返回筛选和手机菜单；不准备或确认任何发布。
 * 长函数保留原因：在同一请求观察窗口验证跨页面连续导航，阶段注释区分链接、菜单和视口场景。 */
export async function runUrlNavigationSmoke(page, origin) {
  const catalog = await (await fetch(origin + '/api/release-center')).json()
  const batch = catalog.items.find((item) => item.kind === 'batch')
  assert.ok(batch, 'URL 回归需要既有合成批次应用')
  const bindings = await (
    await fetch(
      `${origin}/api/projects/${batch.projectId}/applications/${batch.applicationId}/bindings`,
    )
  ).json()
  const ids = bindings.items
    .slice(0, 2)
    .map((item) => item.id)
    .join(',')
  assert.equal(ids.split(',').length, 2)
  const writes = []
  const observer = (request) => {
    if (request.url().startsWith(origin + '/api/') && request.method() !== 'GET')
      writes.push(request.method() + ' ' + request.url())
  }
  page.on('request', observer)
  try {
    // 1. 重放用户的累积链接，保留应用和渠道选择，原位移除跨页参数与可推导模式。
    const polluted = new URL(origin)
    polluted.search = new URLSearchParams({
      view: 'releases',
      project: batch.projectId,
      application: batch.applicationId,
      releaseTask: 'workspace',
      releaseCompose: 'configured',
      releaseSelected: ids,
      releaseView: 'batch',
      releaseProject: batch.projectId,
      releaseApplication: batch.applicationId,
      releaseChannel: 'huawei',
      issueStatus: 'resolved',
      localTab: 'runtime',
      helpTab: 'roadmap',
    }).toString()
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto(polluted.href)
    const workspace = page.getByRole('region', { name: '多渠道发布批次', exact: true })
    await workspace.waitFor()
    const expected = new URLSearchParams({
      view: 'releases',
      project: batch.projectId,
      application: batch.applicationId,
      releaseTask: 'workspace',
      releaseCompose: 'configured',
      releaseSelected: ids,
    }).toString()
    await page.waitForURL((url) => url.search.slice(1) === expected)
    await page.reload()
    await workspace.waitFor()
    assert.equal(new URL(page.url()).search.slice(1), expected)
    const brandNames = {
      huawei: '华为',
      meizu: '魅族',
      xiaomi: '小米',
      oppo: 'OPPO',
      vivo: 'vivo',
      honor: '荣耀',
      tencent: '应用宝',
    }
    const brands = bindings.items.slice(0, 2).map((item) => brandNames[item.channel])
    assert.ok(brands.every(Boolean))
    const summary = await checkChannelSummary(page, brands)
    await summary.screenshot({ path: 'artifacts/channel-summary-android.png' })
    await captureScreenshot(page, 'artifacts/url-navigation-desktop.png')
    await page.getByRole('button', { name: '返回发布列表', exact: true }).click()
    assert.equal(new URL(page.url()).searchParams.get('releaseChannel'), 'huawei')
    assert.equal(new URL(page.url()).searchParams.has('project'), false)
    await page.goBack()
    await workspace.waitFor()
    await page.goForward()
    await page.getByRole('region', { name: '发布中心', exact: true }).waitFor()

    // 2. 每个菜单都进入干净入口；再次点击当前菜单也清除旧详情及筛选。
    for (const [name, view] of [
      ['商店账号', 'accounts'],
      ['应用管理', 'projects'],
      ['审核状态', 'reviews'],
      ['本机设置', 'settings'],
      ['帮助与支持', 'help'],
      ['发布中心', 'releases'],
    ]) {
      await page.getByRole('menuitem', { name, exact: true }).click()
      await page.waitForURL((url) => url.search === '?view=' + view)
    }
    await page.getByRole('menuitem', { name: '帮助与支持', exact: true }).click()
    await page.getByRole('tab', { name: '问题档案', exact: true }).click()
    await page.getByRole('searchbox', { name: '搜索问题', exact: true }).fill('RH-0001')
    await page.waitForURL((url) => url.searchParams.has('issueQ'))
    await page.getByRole('tab', { name: '产品路线图', exact: true }).click()
    await page.waitForURL((url) => url.search === '?view=help&helpTab=roadmap')
    await page.getByRole('tab', { name: '商店指南', exact: true }).click()
    await page.waitForURL((url) => url.search === '?view=help')
    await page.goto(origin + '/?view=settings&storageStatus=ready&storagePage=2')
    await page.getByRole('tab', { name: '运行诊断', exact: true }).click()
    await page.waitForURL((url) => url.search === '?view=settings&localTab=runtime')
    await page.getByRole('tab', { name: '存储管理', exact: true }).click()
    await page.waitForURL((url) => url.search === '?view=settings')

    const appleApp = catalog.projects
      .flatMap((project) => project.applications.map((app) => ({ ...app, projectId: project.id })))
      .find((app) => app.platform === 'ios')
    assert.ok(appleApp)
    const appleBindings = await (
      await fetch(
        `${origin}/api/projects/${appleApp.projectId}/applications/${appleApp.id}/bindings`,
      )
    ).json()
    assert.ok(appleBindings.items[0])
    const appleUrl = new URL(origin)
    appleUrl.search = new URLSearchParams({
      view: 'releases',
      project: appleApp.projectId,
      application: appleApp.id,
      releaseTask: 'workspace',
      releaseCompose: 'configured',
      releaseSelected: appleBindings.items[0].id,
    }).toString()
    await page.goto(appleUrl.href)
    const appleSummary = await checkChannelSummary(page, ['Apple'])
    await appleSummary.screenshot({ path: 'artifacts/channel-summary-ios.png' })

    // 3. 手机与横屏导航使用同一规则，刷新后无任何隐式查询、准备或发布。
    for (const viewport of [
      { width: 375, height: 812 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(viewport)
      await page.goto(polluted.href)
      await workspace.waitFor()
      await page.waitForURL((url) => url.search.slice(1) === expected)
      await checkChannelSummary(page, brands)
      await page.getByRole('button', { name: '打开工作台菜单', exact: true }).click()
      await page.getByRole('menuitem', { name: '商店账号', exact: true }).click()
      await page.waitForURL((url) => url.search === '?view=accounts')
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    }
    await captureScreenshot(page, 'artifacts/url-navigation-mobile.png')
    assert.deepEqual(writes, [], 'URL 清理和导航不能触发业务写入或官方查询')
  } finally {
    page.off('request', observer)
  }
}
