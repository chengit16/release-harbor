/** @description 菜单精简、首页待处理、应用向导和发布页上传的 Chrome 回归，仅使用隔离合成数据。 */
import assert from 'node:assert/strict'
import { syntheticIpa } from '../tests/fixtures/ipa.ts'
import { captureScreenshot } from './capture-screenshot.mjs'

/** 页面导航不能触发商店、预检或发布；新增应用与产物仅写入当前测试服务。 */
export async function runUsabilitySmoke(page, origin) {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const writes = [],
    listener = (request) => {
      if (
        request.method() !== 'GET' &&
        /\/(query|materials|prepare|confirm-and-start|execute|preflights)$/.test(
          new URL(request.url()).pathname,
        )
      )
        writes.push(request.url())
    }
  page.on('request', listener)
  await page.goto(origin)
  await page.getByRole('heading', { name: '发布中心', exact: true }).waitFor()
  const center = page.getByRole('region', { name: '发布中心', exact: true })
  await center.getByRole('button', { name: '刷新发布记录', exact: true }).waitFor()
  assert.deepEqual(await page.getByRole('menuitem').allTextContents(), [
    '发布中心',
    '审核状态',
    '应用管理',
    '商店账号',
    '本机设置',
    '帮助与支持',
  ])
  const response = await (await fetch(origin + '/api/release-center')).json()
  const counts = [
    ['processing', '处理中', response.items.filter((item) => item.state === 'processing').length],
    [
      'confirmation',
      '待确认',
      response.items.filter((item) =>
        ['awaiting_confirmation', 'awaiting_execution'].includes(item.state),
      ).length,
    ],
    [
      'reconciliation',
      '结果待核对',
      response.items.filter((item) => item.needsReconciliation).length,
    ],
  ]
  for (const [key, label, count] of counts) {
    await center.getByRole('button', { name: new RegExp(`^${label} ${count}`) }).click()
    await center.getByText(`找到 ${count} 条发布记录`, { exact: true }).waitFor()
    assert.equal(new URL(page.url()).searchParams.get('releaseFocus'), key)
    await page.reload()
    await center.getByText(`找到 ${count} 条发布记录`, { exact: true }).waitFor()
    await center.getByRole('button', { name: '查看全部记录', exact: true }).click()
  }
  // 1. 只合并帮助入口，旧 URL、刷新、前进后退继续定位原内容。
  await page.getByRole('menuitem', { name: '帮助与支持', exact: true }).click()
  await page.getByRole('tab', { name: '产品路线图', exact: true }).click()
  await page.reload()
  assert.equal(
    await page.getByRole('tab', { name: '产品路线图', exact: true }).getAttribute('aria-selected'),
    'true',
  )
  await page.goto(origin + '/?view=channels')
  await page.getByRole('tab', { name: '商店指南', exact: true }).waitFor()
  await page.getByRole('menuitem', { name: '应用管理', exact: true }).click()
  const directory = page.getByRole('region', { name: '全部应用', exact: true })
  await directory.getByRole('heading', { name: '验收 Android', exact: true }).waitFor()
  await directory.getByRole('heading', { name: '验收 iOS', exact: true }).waitFor()
  await page.getByRole('button', { name: '新建应用', exact: true }).click()
  const setup = page.getByRole('region', { name: '应用配置向导', exact: true })
  await setup.getByLabel('应用名称', { exact: true }).fill('向导验收应用')
  await setup.getByLabel('Android 包名', { exact: true }).fill('com.example.smoke')
  await setup.getByRole('button', { name: '保存并配置渠道', exact: true }).click()
  await setup.getByRole('alert').filter({ hasText: '已登记相同平台' }).waitFor()
  assert.equal(await setup.getByLabel('应用名称', { exact: true }).inputValue(), '向导验收应用')
  await setup.getByLabel('Android 包名', { exact: true }).fill('com.example.onboarding')
  const groupField = setup.locator('.ant-form-item').filter({ hasText: '项目分组（选填）' })
  await groupField.hover()
  await groupField.locator('.ant-select-clear').click()
  const groupsBefore = (await (await fetch(origin + '/api/projects')).json()).items.length
  const applicationRoute = '**/api/projects/*/applications'
  await page.route(applicationRoute, (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 503, json: { message: '合成应用保存失败' } })
      : route.continue(),
  )
  await setup.getByRole('button', { name: '保存并配置渠道', exact: true }).click()
  await setup.getByRole('alert').filter({ hasText: '合成应用保存失败' }).waitFor()
  assert.equal(
    (await (await fetch(origin + '/api/projects')).json()).items.length,
    groupsBefore + 1,
  )
  await page.unroute(applicationRoute)
  await setup.getByRole('button', { name: '保存并配置渠道', exact: true }).click()
  assert.equal(
    (await (await fetch(origin + '/api/projects')).json()).items.length,
    groupsBefore + 1,
    '应用保存失败重试不能重复创建默认分组',
  )
  await setup.getByRole('button', { name: '下一步：就绪检查', exact: true }).click()
  await setup.getByText('待配置渠道', { exact: true }).waitFor()
  assert.equal(
    await setup.getByRole('button', { name: '开始发布', exact: true }).isDisabled(),
    true,
  )
  await setup.getByRole('button', { name: '完成配置', exact: true }).click()
  await page.getByRole('heading', { name: '向导验收应用', exact: true }).waitFor()
  // 2. 多选复用独立批次，华为草稿差异在选择和内容页都明确提示。
  await page.getByRole('menuitem', { name: '发布中心', exact: true }).click()
  await center.getByRole('button', { name: '重置筛选', exact: true }).click()
  await center.getByRole('button', { name: '发起发布', exact: true }).click()
  const batchModal = page.getByRole('dialog', { name: '发起发布', exact: true })
  await batchModal
    .getByRole('combobox', { name: '发布应用', exact: true })
    .fill('多渠道绑定布局验收')
  await batchModal.getByRole('combobox', { name: '发布应用', exact: true }).press('Enter')
  await batchModal.getByRole('button', { name: '开始配置', exact: true }).click()
  await page.getByRole('combobox', { name: '本次发布渠道', exact: true }).click()
  for (const label of ['华为 AppGallery', '小米'])
    await page.locator('.ant-select-dropdown:visible').getByText(label, { exact: true }).click()
  await page.keyboard.press('Escape')
  await page.getByText('本批次的华为渠道仅保存草稿', { exact: true }).waitFor()
  await page.getByRole('button', { name: '继续填写发布内容', exact: true }).click()
  const batch = page.getByRole('region', { name: '多渠道发布批次', exact: true })
  await batch.getByRole('button', { name: '准备 2 个渠道', exact: true }).waitFor()
  assert.equal(await batch.locator('tbody tr[data-row-key]').count(), 2)
  assert.equal(await page.getByRole('group', { name: '发布方式', exact: true }).count(), 0)
  await batch.getByText('保存草稿', { exact: true }).waitFor()
  await page.getByRole('button', { name: '返回发布列表', exact: true }).click()
  // 3. 单选和页内上传联动，检查完成不清除更新说明。

  await page.getByRole('menuitem', { name: '发布中心', exact: true }).click()
  await center.getByRole('button', { name: '重置筛选', exact: true }).click()
  await center.getByRole('button', { name: '发起发布', exact: true }).click()
  const modal = page.getByRole('dialog', { name: '发起发布', exact: true })
  await modal.getByRole('combobox', { name: '发布应用', exact: true }).fill('验收 iOS')
  await modal.getByRole('combobox', { name: '发布应用', exact: true }).press('Enter')
  assert.equal(await modal.getByRole('combobox', { name: '本次发布方式', exact: true }).count(), 0)
  await modal.getByRole('button', { name: '开始配置', exact: true }).click()
  await page.getByRole('combobox', { name: '本次发布渠道', exact: true }).click()
  await page
    .locator('.ant-select-dropdown:visible')
    .getByText('Apple App Store', { exact: true })
    .click()
  await page.getByRole('button', { name: '继续填写发布内容', exact: true }).click()
  await page
    .getByRole('textbox', { name: '更新说明', exact: true })
    .fill('检查新包时必须保留当前更新说明')
  await page.getByText('上传新安装包（可选）', { exact: true }).click()
  await page.locator('input[type=file]').setInputFiles({
    name: '发布页内验收.ipa',
    mimeType: 'application/octet-stream',
    buffer: syntheticIpa('com.example.ios', true),
  })
  await page.getByRole('button', { name: '上传并检查', exact: true }).click()
  await page.getByText('检查通过', { exact: true }).first().waitFor({ timeout: 20000 })
  assert.equal(
    await page.getByRole('textbox', { name: '更新说明', exact: true }).inputValue(),
    '检查新包时必须保留当前更新说明',
  )
  await page.getByRole('combobox', { name: '发布安装包', exact: true }).click()
  await page
    .locator('.ant-select-dropdown:visible')
    .getByText(/发布页内验收.ipa/)
    .waitFor()
  await page.keyboard.press('Escape')
  // 4. 头部几何、手机抽屉导航、横屏及大字体分别验收，不能只以无溢出代替对齐。
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 375, height: 812 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport)
    const crumb = await page
      .getByRole('link', { name: '发布中心', exact: true })
      .evaluate((element) => {
        const range = document.createRange()
        range.selectNodeContents(element)
        return range.getBoundingClientRect().x
      })
    const title = await page.locator('.release-workspace-title h1').boundingBox()
    assert.ok(Math.abs(crumb - title.x) <= 2)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await captureScreenshot(page, `artifacts/usability-publish-${viewport.width}.png`)
  }
  await page.setViewportSize({ width: 375, height: 812 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('button', { name: '打开工作台菜单', exact: true }).click()
  const menu = page.getByRole('dialog', { name: '工作台菜单', exact: true })
  await captureScreenshot(page, 'artifacts/usability-mobile-menu.png')
  await menu.getByRole('menuitem', { name: '应用管理', exact: true }).click()
  await menu.waitFor({ state: 'hidden' })
  await directory.getByRole('heading', { name: '向导验收应用', exact: true }).waitFor()
  await captureScreenshot(page, 'artifacts/usability-applications-mobile.png')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  assert.deepEqual(writes, [], '导航、向导就绪检查和上传不能暗中触发官方查询、预检、准备或授权')
  page.off('request', listener)
  console.log(
    '使用体验 Chrome 验收通过：首页精准分组、精简菜单与旧链接、应用平铺、向导失败保稿和缺项、页内上传联动、手机抽屉和三种视口对齐。',
  )
}
