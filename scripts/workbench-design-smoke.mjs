/** @description 全站设计回归；复用隔离合成目录，只读导航与截图不调用商店或修改业务数据。 */
import { openWorkbenchPage, readNavigationUrl } from './navigation-state.mjs'
import assert from 'node:assert/strict'
import { captureScreenshot } from './capture-screenshot.mjs'

/** 核对首屏密度、移动记录、筛选恢复、帮助层级和键盘入口；原发布安全流程由完整冒烟覆盖。
 * 长函数保留原因：顺序导航在同一请求观察窗口下证明零写入，阶段内保留断言便于定位页面回归。 */
export async function runWorkbenchDesignSmoke(page, origin) {
  const mutations = []
  const observer = (request) => {
    if (request.method() !== 'GET' && new URL(request.url()).pathname.startsWith('/api/'))
      mutations.push(request.url())
  }
  page.on('request', observer)
  // 1. 发布中心桌面记录进入首屏，手机用同一 URL 分页卡片，展开筛选不改变数据。
  await page.setViewportSize({ width: 1440, height: 900 })
  await openWorkbenchPage(page, origin + '/?view=releases')
  const center = page.getByRole('region', { name: '发布中心', exact: true })
  await center.getByText(/找到 \d+ 条发布记录/).waitFor()
  const firstRow = center.locator('tbody tr[data-row-key]').first()
  await firstRow.waitFor()
  const centerBounds = await firstRow.boundingBox()
  assert.ok(centerBounds.y < 450, `发布首条记录下沉：${centerBounds.y}`)
  await captureScreenshot(page, 'artifacts/design-home-1440.png')
  const search = center.getByRole('textbox', { name: '搜索发布记录', exact: true })
  await search.fill('不存在的合成发布记录')
  await center.getByText('没有符合当前筛选条件的发布记录。', { exact: true }).waitFor()
  assert.equal(
    (await readNavigationUrl(page)).searchParams.get('releaseQuery'),
    '不存在的合成发布记录',
  )
  await page.reload()
  assert.equal(await search.inputValue(), '不存在的合成发布记录')
  await search.fill('')
  await firstRow.waitFor()
  await page.setViewportSize({ width: 375, height: 812 })
  const cards = page.getByRole('list', { name: '发布记录', exact: true })
  await cards.getByRole('listitem').first().waitFor()
  assert.equal(await center.getByRole('table').count(), 0, '手机不能继续使用横向宽表')
  // 分页自身也含 listitem，数量只核对最外层的发布卡片。
  assert.ok((await cards.locator(':scope > [role="listitem"]').count()) <= 10)
  await cards
    .getByRole('listitem')
    .first()
    .getByText(/构建|尚未冻结版本/)
    .waitFor()
  await cards.getByRole('listitem').first().getByRole('button', { name: /^查看/ }).waitFor()
  assert.equal(await center.getByRole('combobox', { name: '筛选应用', exact: true }).count(), 0)
  await center.getByRole('button', { name: '筛选条件（全部）', exact: true }).click()
  await center.getByRole('combobox', { name: '筛选渠道', exact: true }).click()
  await page.locator('.ant-select-dropdown:visible').getByText('小米', { exact: true }).click()
  assert.equal((await readNavigationUrl(page)).searchParams.get('releaseChannel'), 'xiaomi')
  await page.reload()
  await center.getByRole('button', { name: '筛选条件（已选 1 项）', exact: true }).waitFor()
  await page.goBack()
  await center.getByRole('button', { name: '筛选条件（全部）', exact: true }).waitFor()
  await center.getByText(/找到 \d+ 条发布记录/).waitFor()
  await cards.locator(':scope > [role="listitem"]').first().waitFor()
  await captureScreenshot(page, 'artifacts/design-home-375.png')
  // 2. 审核三项主视图可达，次级历史从更多进入；刷新只读缓存。
  await page.setViewportSize({ width: 1440, height: 900 })
  await openWorkbenchPage(page, origin + '/?view=reviews')
  const review = page.getByRole('region', { name: '商店状态查询', exact: true })
  await review.getByText(/找到 \d+ 个商店绑定/).waitFor()
  const reviewBounds = await review.locator('tbody tr[data-row-key]').first().boundingBox()
  assert.ok(reviewBounds && reviewBounds.y < 450, `审核首条记录下沉：${reviewBounds?.y}`)
  await captureScreenshot(page, 'artifacts/design-reviews-1440.png')
  await page.setViewportSize({ width: 375, height: 812 })
  for (const label of ['商店状态', '跟踪任务', '待办处理'])
    assert.ok(
      await page.getByRole('tab', { name: label, exact: true }).isVisible(),
      `${label} 不应被次级入口挤出`,
    )
  await review.getByRole('button', { name: '刷新商店目录', exact: true }).click()
  await review.getByText(/找到 \d+ 个商店绑定/).waitFor()
  const pagination = review.locator('.ant-list-pagination')
  const paginationBounds = await pagination.boundingBox()
  assert.ok(
    paginationBounds &&
      paginationBounds.x >= 0 &&
      paginationBounds.x + paginationBounds.width <= 375,
  )
  const firstCardName = await review
    .locator('.ant-list-item .ant-card-head-title')
    .first()
    .textContent()
  await pagination.getByTitle('下一页', { exact: true }).click()
  assert.notEqual(
    await review.locator('.ant-list-item .ant-card-head-title').first().textContent(),
    firstCardName,
  )
  await pagination.getByTitle('上一页', { exact: true }).click()
  assert.equal(
    await review.locator('.ant-list-item .ant-card-head-title').first().textContent(),
    firstCardName,
  )
  await captureScreenshot(page, 'artifacts/design-reviews-375.png')
  await page.getByRole('button', { name: '更多审核视图', exact: true }).click()
  await page.getByRole('menuitem', { name: '本地发布关联', exact: true }).click()
  await page.getByRole('region', { name: '审核状态', exact: true }).waitFor()
  // 3. 六类页面在桌面、手机、横屏与折半可用宽度下保持对齐；不冒充系统缩放验收。
  for (const view of ['projects', 'accounts', 'settings', 'help']) {
    await openWorkbenchPage(page, origin + '/?view=' + view)
    await page.getByRole('heading', { level: 1 }).waitFor()
    if (view === 'accounts') {
      await page.getByRole('button', { name: '新增商店账号', exact: true }).waitFor()
      assert.equal(await page.getByRole('heading', { name: '商店账号', exact: true }).count(), 1)
    }
    for (const width of [1440, 375, 844, 720]) {
      await page.setViewportSize({ width, height: width === 844 ? 390 : 900 })
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      )
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `${view}/${width} 整页横向溢出`,
      )
      const heading = await page.locator('.page-heading h1').boundingBox()
      const content = await page
        .locator('#workbench-content')
        .evaluate(
          (node) => node.getBoundingClientRect().x + parseFloat(getComputedStyle(node).paddingLeft),
        )
      assert.ok(heading && Math.abs(heading.x - content) <= 2, `${view}/${width} 标题未对齐`)
      if (width !== 720) await captureScreenshot(page, `artifacts/design-${view}-${width}.png`)
    }
  }
  await openWorkbenchPage(page, origin + '/?view=help&helpTab=roadmap')
  await page.getByText('本机团队工作台 T0–T4 已交付', { exact: true }).waitFor()
  await page.getByRole('button', { name: '第三至第五期交付范围与验收边界', exact: true }).click()
  await page.getByText('第四期工程范围已完成', { exact: true }).waitFor()
  await page.setViewportSize({ width: 1440, height: 900 })
  await openWorkbenchPage(page, origin)
  await page.keyboard.press('Tab')
  await page.getByRole('link', { name: '跳至页面内容', exact: true }).press('Enter')
  assert.equal(
    await page.locator('#workbench-content').evaluate((node) => node === document.activeElement),
    true,
  )
  assert.equal(await page.locator('h1').count(), 1)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal(
    await page
      .getByRole('button', { name: '发起发布', exact: true })
      .evaluate((node) => getComputedStyle(node).animationName),
    'none',
  )
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  page.off('request', observer)
  assert.deepEqual(mutations, [], '设计回归导航、筛选和刷新不能产生业务写入或商店查询')
  console.log(
    `全站设计 Chrome 验收通过：首条发布记录 ${Math.round(centerBounds.y)}px、审核记录 ${Math.round(reviewBounds.y)}px；手机卡片与筛选、主页签、账号单标题、六类入口、1440／375／844／720布局、键盘跳转、低动效、导航零写入。`,
  )
}
