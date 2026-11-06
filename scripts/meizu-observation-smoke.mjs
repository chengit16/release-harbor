/** @description 魅族审核状态真实浏览器回归；只使用隔离执行夹具，验证新锚点、旧记录提示与零隐式查询。 */
import assert from 'node:assert/strict'
import { captureScreenshot } from './capture-screenshot.mjs'

/** 先由发布记录带上下文跳转，再显式查询；刷新、关闭和导航均不得重放发布或查询。 */
export async function runMeizuObservationSmoke(page, origin) {
  const start = page.url(),
    location = new URL(start)
  const root = `${origin}/api/projects/${location.searchParams.get('project')}/applications/${location.searchParams.get('application')}`
  const plan = (await (await fetch(root + '/release-plans')).json()).items[0].plan
  const attempts = await (await fetch(root + '/release-attempts')).text()
  assert.equal(JSON.parse(attempts).items[0].reviewAnchor.versionId, '200')
  let queries = 0
  const observer = (request) => {
    if (request.url().startsWith(origin + '/api/') && request.method() !== 'GET') {
      assert.ok(request.url().endsWith('/observations') && request.method() === 'POST')
      queries++
    }
  }
  page.on('request', observer)
  location.searchParams.set('view', 'reviews')
  location.searchParams.set('reviewProject', location.searchParams.get('project'))
  location.searchParams.set('reviewApplication', location.searchParams.get('application'))
  location.searchParams.set('reviewRecord', `plan:${plan.id}`)
  location.searchParams.delete('tab')
  await page.goto(location.href)
  const detail = page.getByRole('dialog', { name: '审核状态详情', exact: true })
  await detail.getByRole('button', { name: '查询魅族状态', exact: true }).waitFor()
  await detail.getByText(/魅族详情不提供构建号/).waitFor()
  assert.equal(queries, 0)
  await detail.getByRole('button', { name: '查询魅族状态', exact: true }).click()
  await detail.getByText('审核未通过', { exact: true }).waitFor()
  await detail.getByText(/请到魅族开发者后台查看具体审核意见/).waitFor()
  assert.equal(queries, 1)
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 })
    assert.ok(await detail.evaluate((e) => e.scrollWidth <= e.clientWidth))
    await captureScreenshot(page, `artifacts/meizu-observation-${width}.png`)
  }
  await page.reload()
  await detail.getByText('审核未通过', { exact: true }).waitFor()
  assert.ok(await detail.getByRole('button', { name: '查询魅族状态', exact: true }).isDisabled())
  await detail.getByRole('button', { name: '关闭审核详情', exact: true }).click()
  await page
    .getByRole('region', { name: '审核状态', exact: true })
    .getByText('审核未通过', { exact: true })
    .waitFor()
  assert.equal(queries, 1)
  assert.equal(await (await fetch(root + '/release-attempts')).text(), attempts)
  // 仅覆盖合成只读响应，旧记录缺锚点的呈现不能出现查询或要求重新提交。
  await page.route('**/api/review-tracking', async (route) => {
    const response = await route.fetch(),
      body = await response.json()
    const item = body.items.find((i) => i.id === plan.id)
    Object.assign(item, {
      querySupported: false,
      state: 'not_queried',
      todo: 'store_console',
      observation: null,
    })
    await route.fulfill({ response, json: body })
  })
  await page.goto(location.href)
  await detail.getByText('该历史记录未保存魅族送审版本 ID', { exact: true }).waitFor()
  await detail.getByText(/无需重新提交/).waitFor()
  assert.equal(await detail.getByRole('button', { name: '查询魅族状态', exact: true }).count(), 0)
  assert.equal(queries, 1)
  await page.unroute('**/api/review-tracking')
  page.off('request', observer)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(start)
}
