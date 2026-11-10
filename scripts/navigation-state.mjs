/** @description 浏览器验收读取公开历史定位；同时检查地址栏仅有菜单，不依赖页面残留查询参数。 */
import assert from 'node:assert/strict'

/** 测试场景重新访问页面；同址 goto 可能复用刷新状态，先离开文档，菜单与刷新由专项验证。 */
export async function openWorkbenchPage(page, href) {
  if (href === page.url()) await page.goto('about:blank')
  await page.goto(href)
}

/** 等待旧链接迁入当前历史项，再构造仅供测试恢复旧深链的完整定位；不写入业务状态。 */
export async function readNavigationUrl(page) {
  await page.waitForFunction(() => {
    const params = new URLSearchParams(location.search)
    return (
      [...params.keys()].every((key) => key === 'view') &&
      history.state?.harborNavigation?.version === 1
    )
  })
  const entry = await page.evaluate(() => ({
    href: location.href,
    search: history.state.harborNavigation.search,
  }))
  const url = new URL(entry.href)
  const addressView = url.searchParams.get('view')
  url.search = entry.search
  assert.equal(url.searchParams.get('view'), addressView, '历史定位必须属于当前菜单')
  return url
}

/** 等待当前历史项中的明确字段；null 表示清除，true 表示非空，不能只等待未变化的短地址。 */
export async function waitForNavigationState(page, expected) {
  await page.waitForFunction((fields) => {
    const params = new URLSearchParams(history.state?.harborNavigation?.search)
    return Object.entries(fields).every(([key, value]) =>
      value === true ? Boolean(params.get(key)) : params.get(key) === value,
    )
  }, expected)
  await readNavigationUrl(page)
}
