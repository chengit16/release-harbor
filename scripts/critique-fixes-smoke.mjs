/** @description 五项体验修正回归；只拦截合成 GET 响应，不修改服务数据或请求商店。 */
import { openWorkbenchPage } from './navigation-state.mjs'
import assert from 'node:assert/strict'
import { captureScreenshot } from './capture-screenshot.mjs'

/** 验证未知统计、版本身份、具体回执、横屏卡片及手机输入顺序，监听整个窗口的零业务写入。
 * 长函数保留原因：同一观察窗口串联三类表面，确保导航和视口切换不能触发查询或发布。 */
export async function runCritiqueFixesSmoke(page, origin) {
  const writes = []
  const observe = (request) => {
    if (request.method() !== 'GET' && request.url().startsWith(origin + '/api/'))
      writes.push(request.url())
  }
  page.on('request', observe)
  const source = await (await fetch(origin + '/api/store-status')).json()
  const target = source.targets.find((item) => item.channel === 'huawei')
  assert.ok(target)
  const tencent = {
    ...target,
    bindingId: '00000000-0000-4000-8000-000000000001',
    channel: 'tencent',
    applicationName: '应用级审核合成样本',
  }
  const response = { targets: [target, tencent], snapshots: [] }
  const mock = (route) => route.fulfill({ json: response })
  await page.route('**/api/store-status', mock)
  // 1. 无缓存与最近失败都不能生成审核／在架零值；旧成功仅在详情作为历史保留。
  await page.setViewportSize({ width: 1440, height: 900 })
  await openWorkbenchPage(page, origin + '/?view=reviews')
  const region = page.getByRole('region', { name: '商店状态查询', exact: true })
  const metrics = region.getByLabel('渠道概览', { exact: true })
  await region.getByText('找到 2 个商店绑定', { exact: true }).waitFor()
  assert.match(await metrics.textContent(), /已知审核中尚未查询/)
  assert.match(await metrics.textContent(), /已知在架尚未查询/)
  const successful = {
    bindingId: target.bindingId,
    channel: target.channel,
    code: 'observed',
    checkedAt: '2026-11-08T04:00:00.000Z',
    versions: [
      {
        versionId: '301',
        versionName: '3.2.0',
        buildNumber: '42',
        state: 'in_review',
        rawState: 20,
      },
      {
        versionId: '300',
        versionName: '3.1.0',
        buildNumber: '40',
        state: 'published',
        rawState: 0,
      },
    ],
  }
  response.snapshots = [
    { ...successful, code: 'network', versions: [], checkedAt: '2026-11-08T05:00:00.000Z' },
    successful,
  ]
  await page.reload()
  await region.getByText('本次查询失败', { exact: true }).waitFor()
  assert.match(await metrics.textContent(), /已知审核中未知/)
  assert.match(await metrics.textContent(), /成功缓存 0\/2/)
  // 2. 已知结果显示覆盖数量，列表中每条状态紧邻原版本；应用级审核明确不关联新包。
  response.snapshots = [
    successful,
    {
      ...successful,
      bindingId: tencent.bindingId,
      channel: 'tencent',
      versions: [
        { versionId: null, versionName: null, buildNumber: null, state: 'approved', rawState: 3 },
      ],
    },
  ]
  for (const width of [1440, 375, 844]) {
    await page.setViewportSize({ width, height: width === 844 ? 390 : 900 })
    await page.reload()
    await region.getByText('3.2.0 · 构建 42', { exact: true }).waitFor()
    await region.getByText('3.1.0 · 构建 40', { exact: true }).waitFor()
    await region.getByText('当前审核流程（官方未返回对应版本）', { exact: true }).waitFor()
    const pair = region.locator('.store-status-version-summary').filter({ hasText: '3.2.0' })
    assert.match(await pair.textContent(), /审核中/)
    assert.match(await metrics.textContent(), /成功缓存 2\/2/)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await captureScreenshot(page, `artifacts/critique-fixed-reviews-${width}.png`)
  }
  await page.unroute('**/api/store-status', mock)
  // 3. 复用真实合成历史，横屏必须完整显示状态与动作，不允许宽表藏住回执。
  const releases = await (await fetch(origin + '/api/release-center')).json()
  for (const width of [1440, 375, 844]) {
    await page.setViewportSize({ width, height: width === 844 ? 390 : 900 })
    await openWorkbenchPage(page, origin + '/?view=releases')
    await page.getByText(`找到 ${releases.items.length} 条发布记录`, { exact: true }).waitFor()
    if (width < 992) {
      assert.equal(await page.getByRole('table').count(), 0)
      const first = page
        .getByRole('list', { name: '发布记录', exact: true })
        .locator(':scope > [role="listitem"]')
        .first()
      await first.getByRole('button', { name: /^查看/ }).waitFor()
      const box = await first.boundingBox()
      assert.ok(box.x >= 0 && box.x + box.width <= width)
      assert.ok(box.x < 50 && box.width > width - 100, '卡片必须使用完整紧凑内容宽度')
      const sidebar = await page.locator('.sidebar').boundingBox()
      const content = await page.locator('.content').boundingBox()
      assert.ok(
        sidebar.height < 100 && content.y >= sidebar.y + sidebar.height,
        '导航必须位于内容上方',
      )
      assert.ok(await page.locator('.brand-mark').isVisible(), '紧凑导航保留品牌标记')
      assert.ok(await page.getByRole('button', { name: '打开工作台菜单' }).isVisible())
    }
    const receipt = releases.items.find(
      (item) => item.kind === 'apple' && item.code === 'submitted',
    )
    assert.ok(receipt)
    await page.getByText('审核提交已受理', { exact: true }).first().waitFor()
    assert.equal(await page.getByText('执行完成', { exact: true }).count(), 0)
    await captureScreenshot(page, `artifacts/critique-fixed-center-${width}.png`)
  }
  // 4. 只导航到已有合成 iOS 应用，草稿跨视口保留，概览的 DOM／焦点顺序先于准备按钮。
  const owner = releases.projects.find((item) =>
    item.applications.some((app) => app.name === '验收 iOS'),
  )
  const app = owner.applications.find((item) => item.name === '验收 iOS')
  const bindings = (
    await (await fetch(`${origin}/api/projects/${owner.id}/applications/${app.id}/bindings`)).json()
  ).items
  const url =
    origin +
    '/?' +
    new URLSearchParams({
      view: 'releases',
      project: owner.id,
      application: app.id,
      releaseTask: 'workspace',
      releaseCompose: 'configured',
      releaseSelected: bindings[0].id,
    })
  await openWorkbenchPage(page, url)
  const notes = page.getByRole('textbox', { name: '更新说明', exact: true })
  await notes.fill('视口变化后必须保留说明与策略草稿')
  await notes.blur()
  for (const width of [1440, 375, 844]) {
    await page.setViewportSize({ width, height: width === 844 ? 390 : 812 })
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          window.scrollTo(0, 0)
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        }),
    )
    assert.equal(await page.locator('h1').count(), 1)
    const packageBox = await page
      .getByRole('combobox', { name: '发布安装包', exact: true })
      .boundingBox()
    assert.ok(packageBox.y < (width === 375 ? 520 : 600), `主要输入下沉：${width}/${packageBox.y}`)
    assert.equal(await notes.inputValue(), '视口变化后必须保留说明与策略草稿')
    assert.ok(
      await page
        .locator('.release-form-summary')
        .evaluate(
          (node) =>
            !!(
              node.compareDocumentPosition(document.querySelector('.release-form-actions')) &
              Node.DOCUMENT_POSITION_FOLLOWING
            ),
        ),
    )
    if (width < 992) {
      await page.getByRole('button', { name: '草稿概览（非执行授权）', exact: true }).click()
      await page
        .getByLabel('本次发布概览', { exact: true })
        .getByText('上传构建，尚不送审', { exact: true })
        .waitFor()
      await page.getByRole('button', { name: '草稿概览（非执行授权）', exact: true }).click()
    }
    await captureScreenshot(page, `artifacts/critique-fixed-form-${width}.png`)
  }
  page.off('request', observe)
  assert.deepEqual(writes, [], '五项修正的读取、导航、草稿和视口切换不能触发业务写入')
  await page.setViewportSize({ width: 1440, height: 900 })
  console.log(
    '五项体验修正 Chrome 复验通过：未知与失败统计、成功覆盖率、状态版本配对、应用级范围、具体回执、844横屏卡片、主要输入前置、草稿不丢与导航零写入。',
  )
}
