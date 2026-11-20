/** @description 账号卡片浏览器回归，使用隔离目录及安全目录替身验证布局、筛选和错误恢复，不读秘密或访问商店。 */
import { openWorkbenchPage } from './navigation-state.mjs'
import assert from 'node:assert/strict'
import { captureScreenshot } from './capture-screenshot.mjs'

/** 覆盖卡片列数、长名称、状态、关联搜索和维护焦点，所有动作仅查询本机目录。
 * 长函数保留原因：同一隔离页面连续记录零写入窗口，保留各阶段几何与交互证据。 */
export async function runAccountCardsSmoke(page, origin) {
  const mutations = []
  const observer = (request) => {
    if (request.method() !== 'GET' && new URL(request.url()).pathname.startsWith('/api/'))
      mutations.push(request.url())
  }
  page.on('request', observer)
  // 1. 目录来自合成服务，仅在响应中替换展示文字，验证长内容与未知状态不破坏卡片。
  const original = (await (await fetch(origin + '/api/credential-accounts')).json()).catalog
  assert.ok(original.accounts.length >= 3)
  const accountWithApplication = original.accounts.find((account) => account.applications?.length)
  assert.ok(accountWithApplication)
  const longName = '用于核对换行的很长账号别名'.repeat(6)
  const longApplication = '跨项目同名应用的完整公开名称'.repeat(4)
  const sample = {
    ...original,
    accounts: original.accounts.map((account, index) => ({
      ...account,
      ...(index === 0 ? { displayName: longName, needsReconciliation: true } : {}),
      ...(index === 1 ? { configured: false } : {}),
      applications: account.applications.map((application) => ({
        ...application,
        name: longApplication,
      })),
    })),
  }
  const endpoint = '**/api/credential-accounts'
  await page.route(endpoint, (route) => route.fulfill({ json: { catalog: sample } }))
  await openWorkbenchPage(page, origin + '/?view=accounts')
  const region = page.getByRole('region', { name: '商店账号管理', exact: true })
  const cards = region.getByRole('list', { name: '商店账号', exact: true }).getByRole('listitem')
  await cards.first().waitFor()
  assert.equal(await cards.count(), sample.accounts.length)
  await region.getByText('保存待核对', { exact: true }).waitFor()
  await region.getByText('待配置凭据', { exact: true }).waitFor()
  const layoutResults = []
  // 2. 核对几何关系，既检查卡片列数也检查标题、工具栏、首卡左边缘与内部控件范围。
  for (const [width, columns] of [
    [1440, 3],
    [1100, 2],
    [844, 2],
    [720, 2],
    [375, 1],
  ]) {
    await page.setViewportSize({ width, height: width === 844 ? 390 : 900 })
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
    const geometry = await region.evaluate((node) => {
      const grid = node.querySelector('.credential-account-grid')
      const first = node.querySelector('.credential-account-card').getBoundingClientRect()
      const heading = node.querySelector('h1').getBoundingClientRect()
      const toolbar = node.querySelector('.account-toolbar').getBoundingClientRect()
      const addButton = node.querySelector('.account-heading > button').getBoundingClientRect()
      return {
        columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
        aligned: Math.abs(first.x - heading.x) <= 2 && Math.abs(first.x - toolbar.x) <= 2,
        actionsCentered:
          Math.abs(heading.y + heading.height / 2 - addButton.y - addButton.height / 2) <= 2,
        fits: [...node.querySelectorAll('.credential-account-card')].every((card) =>
          [
            ...card.querySelectorAll(
              'h3, .account-provider, .account-applications, .account-card-footer, button',
            ),
          ].every((child) => {
            const outer = card.getBoundingClientRect(),
              inner = child.getBoundingClientRect()
            return inner.x >= outer.x && inner.right <= outer.right && inner.bottom <= outer.bottom
          }),
        ),
        noOverflow: document.documentElement.scrollWidth <= innerWidth,
      }
    })
    assert.equal(geometry.columns, columns, `${width}px 卡片列数`)
    assert.ok(
      geometry.aligned && geometry.actionsCentered && geometry.fits && geometry.noOverflow,
      `${width}px 卡片几何错误：${JSON.stringify(geometry)}`,
    )
    layoutResults.push(`${width}px/${columns}列`)
    await captureScreenshot(page, `artifacts/account-cards-${width}.png`)
  }
  // 3. 搜索与筛选组合不请求商店；维护抽屉可从键盘进入，关闭恢复原按钮焦点。
  const search = region.getByRole('textbox', { name: '搜索账号或关联应用', exact: true })
  await search.fill(longApplication)
  assert.equal(
    await cards.count(),
    sample.accounts.filter((account) => account.applications.length).length,
  )
  await region.getByRole('combobox', { name: '账号渠道筛选', exact: true }).click()
  await page
    .locator('.ant-select-dropdown:visible')
    .getByText('华为 AppGallery', { exact: true })
    .click()
  assert.equal(
    await cards.count(),
    sample.accounts.filter((account) => account.channel === 'huawei' && account.applications.length)
      .length,
  )
  await search.fill('不存在的账号与应用')
  await region.getByText('没有匹配的账号，请调整搜索或渠道筛选。', { exact: true }).waitFor()
  await search.fill('')
  await region.getByRole('combobox', { name: '账号渠道筛选', exact: true }).click()
  await page.locator('.ant-select-dropdown:visible').getByText('全部渠道', { exact: true }).click()
  const manage = cards.first().getByRole('button', { name: /^管理账号/ })
  await manage.focus()
  await manage.press('Enter')
  const drawer = page.getByRole('dialog', { name: '账号维护', exact: true })
  await drawer.waitFor()
  await drawer.getByRole('button', { name: '关闭账号维护', exact: true }).click()
  await drawer.waitFor({ state: 'hidden' })
  assert.ok(await manage.evaluate((node) => node === document.activeElement))
  // 4. 明确的读取失败不伪装为空目录，手动刷新后恢复真实合成目录。
  await page.unroute(endpoint)
  await page.route(endpoint, (route) =>
    route.fulfill({ status: 503, json: { statusCode: 503, message: '合成目录暂不可用' } }),
  )
  await region.getByRole('button', { name: '刷新列表', exact: true }).click()
  await region.getByRole('alert').filter({ hasText: '合成目录暂不可用' }).waitFor()
  assert.equal(await cards.count(), 0)
  await page.unroute(endpoint)
  await region.getByRole('button', { name: '刷新列表', exact: true }).click()
  await cards.first().waitFor()
  assert.equal(await cards.count(), original.accounts.length)
  await page.reload()
  await cards.first().waitFor()
  page.off('request', observer)
  assert.deepEqual(mutations, [], '账号卡片搜索、刷新及查看不能产生业务写入')
  await page.setViewportSize({ width: 1440, height: 900 })
  console.log(
    `账号卡片 Chrome 验收通过：${layoutResults.join('、')}，长名称、关联搜索、组合筛选、无匹配、错误恢复、键盘维护与焦点恢复、零写入。`,
  )
}
