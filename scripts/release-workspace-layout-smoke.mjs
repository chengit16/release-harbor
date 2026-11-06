/** @description 发布工作区页头与配置边界回归；只检查导航和几何位置，不触发商店动作。 */
import assert from 'node:assert/strict'
import { captureScreenshot } from './capture-screenshot.mjs'

/** iOS 配置仅保留三项配置；旧审核深链恢复发布中心，页头在桌面和窄屏保持对齐。 */
export async function runReleaseWorkspaceLayoutSmoke(page) {
  const config = new URL(page.url())
  config.searchParams.set('view', 'projects')
  config.searchParams.set('tab', 'bindings')
  config.searchParams.delete('releaseTask')
  await page.goto(config.href)
  await page.getByRole('tab', { name: '商店绑定', exact: true }).waitFor()
  assert.deepEqual(await page.getByRole('tab').allTextContents(), [
    '商店绑定',
    '安装包',
    '只读预检',
  ])
  assert.equal(await page.getByRole('region', { name: 'Apple 审核与发布', exact: true }).count(), 0)
  // 旧链接必须迁移到发布工作区，不能回到已移除的配置页签。
  config.searchParams.set('tab', 'apple-review')
  await page.goto(config.href)
  await page.getByRole('region', { name: 'Apple 审核与发布', exact: true }).waitFor()
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 375, height: 812 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport)
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
    // Ant Design 链接的负边距扩大点击区；验收可见文字起点，不把点击区当成文字坐标。
    const breadcrumb = await page
      .getByRole('link', { name: '发布中心', exact: true })
      .evaluate((element) => {
        const range = document.createRange()
        range.selectNodeContents(element)
        return { x: range.getBoundingClientRect().x }
      })
    const title = await page.locator('.release-workspace h3').first().boundingBox()
    const tag = await page.locator('.release-workspace-header .ant-tag').boundingBox()
    const back = await page.getByRole('button', { name: '返回发布列表', exact: true }).boundingBox()
    const manage = await page
      .getByRole('button', { name: '管理应用配置', exact: true })
      .boundingBox()
    assert.ok(breadcrumb && title && tag && back && manage, '发布页头必须完整可见')
    assert.ok(Math.abs(breadcrumb.x - title.x) <= 2, '面包屑与应用标题左边缘未对齐')
    assert.ok(
      Math.abs(title.y + title.height / 2 - tag.y - tag.height / 2) <= 2,
      '平台标签与应用标题未居中对齐',
    )
    assert.ok(
      Math.abs(back.y + back.height / 2 - manage.y - manage.height / 2) <= 2,
      '页头操作按钮未居中对齐',
    )
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      '发布工作区横向溢出',
    )
    await captureScreenshot(page, `artifacts/release-workspace-${viewport.width}.png`)
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: '管理应用配置', exact: true }).click()
  await page.getByRole('tab', { name: '商店绑定', exact: true }).waitFor()
  assert.equal(await page.getByRole('tab', { name: '审核与发布', exact: true }).count(), 0)
}
