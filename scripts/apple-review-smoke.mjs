/** @description 已有 Apple 构建送审与手动发布的隔离 Chrome 验收；所有远端状态由合成传输产生。 */
import assert from 'node:assert/strict'
import { captureScreenshot } from './capture-screenshot.mjs'
import { runReleaseWorkspaceLayoutSmoke } from './release-workspace-layout-smoke.mjs'
import { openReleasePlanWorkspace } from './release-center-smoke.mjs'

/** 复用合成 iOS 账号与已有构建，全程不上传 IPA，也不访问真实 Apple。 */
export async function runAppleReviewSmoke(page, origin) {
  await runReleaseWorkspaceLayoutSmoke(page)
  const url = new URL(page.url()),
    base = `${origin}/api/projects/${url.searchParams.get('project')}/applications/${url.searchParams.get('application')}/apple-review`
  const reviewUrl = new URL(page.url())
  reviewUrl.searchParams.set('view', 'releases')
  reviewUrl.searchParams.set('releaseTask', 'workspace')
  reviewUrl.searchParams.set('releaseApple', 'review')
  reviewUrl.searchParams.delete('tab')
  await page.goto(reviewUrl.href)
  const panel = page.getByRole('region', { name: 'Apple 审核与发布', exact: true })
  await panel.getByRole('combobox', { name: 'Apple 商店绑定', exact: true }).click()
  await page
    .locator('.ant-select-dropdown:visible')
    .getByText('Apple · App ID 200002', { exact: true })
    .click()
  await panel.getByRole('button', { name: '刷新 Apple 构建与状态', exact: true }).click()
  await panel.getByText(/Apple 查询时间/).waitFor()
  await panel.getByRole('combobox', { name: '已有 Apple 构建', exact: true }).click()
  await page
    .locator('.ant-select-dropdown:visible')
    .getByText('1.2.3 (42) · VALID', { exact: true })
    .click()
  await panel.getByRole('combobox', { name: '对应商店版本', exact: true }).click()
  await page
    .locator('.ant-select-dropdown:visible')
    .getByText('1.2.3 · PREPARE_FOR_SUBMISSION', { exact: true })
    .click()
  await panel.getByRole('radio', { name: '审核通过后手动发布', exact: true }).check()
  await panel
    .getByRole('textbox', { name: '本次更新说明', exact: true })
    .fill('Apple 已有构建送审合成说明')
  await panel.getByRole('button', { name: '准备 Apple 审核', exact: true }).click()
  let summary = page.getByRole('dialog', { name: 'Apple 发布摘要', exact: true })
  await summary.waitFor()
  assert.equal(
    await summary.getByRole('button', { name: '确认提交 Apple 审核', exact: true }).isEnabled(),
    false,
  )
  const records = async () => (await (await fetch(base)).json()).items
  assert.equal((await records())[0].consumedAt, null)
  await summary.getByRole('button', { name: '关闭摘要', exact: true }).click()
  await page.reload()
  await panel.getByRole('button', { name: '查看摘要', exact: true }).first().click()
  summary = page.getByRole('dialog', { name: 'Apple 发布摘要', exact: true })
  await summary.getByRole('checkbox').check()
  await page.setViewportSize({ width: 390, height: 844 })
  assert.ok(await summary.evaluate((e) => e.scrollWidth <= e.clientWidth))
  await captureScreenshot(page, 'artifacts/apple-review-summary-mobile.png')
  await summary.getByRole('button', { name: '确认提交 Apple 审核', exact: true }).click()
  await summary.waitFor({ state: 'hidden' })
  await panel.getByText('Apple 已受理审核提交，尚不代表审核通过或上架', { exact: true }).waitFor()
  const sent = (await records())[0]
  assert.equal(sent.code, 'submitted')
  assert.ok(sent.remoteStartedAt)
  await page.reload()
  assert.equal((await records()).length, 1)
  // 刷新远端事实是显式只读动作，不将本地受理记录当作审核通过。
  await panel.getByRole('combobox', { name: 'Apple 商店绑定', exact: true }).click()
  await page
    .locator('.ant-select-dropdown:visible')
    .getByText('Apple · App ID 200002', { exact: true })
    .click()
  await panel.getByRole('button', { name: '刷新 Apple 构建与状态', exact: true }).click()
  await panel.getByText('待开发者发布', { exact: true }).first().waitFor()
  await panel.getByRole('radio', { name: '手动发布已批准版本', exact: true }).check()
  await panel.getByRole('combobox', { name: '已有 Apple 构建', exact: true }).click()
  await page
    .locator('.ant-select-dropdown:visible')
    .getByText('1.2.3 (42) · VALID', { exact: true })
    .click()
  await panel.getByRole('combobox', { name: '对应商店版本', exact: true }).click()
  await page
    .locator('.ant-select-dropdown:visible')
    .getByText('1.2.3 · PENDING_DEVELOPER_RELEASE', { exact: true })
    .click()
  await panel.getByRole('button', { name: '准备手动发布', exact: true }).click()
  summary = page.getByRole('dialog', { name: 'Apple 发布摘要', exact: true })
  await summary.getByRole('checkbox').check()
  await summary.getByRole('button', { name: '确认请求手动发布', exact: true }).click()
  await summary.waitFor({ state: 'hidden' })
  await panel.getByText('Apple 已受理手动发布请求，尚不代表已上架', { exact: true }).waitFor()
  const released = await records()
  assert.equal(released.length, 2)
  assert.equal(released[0].code, 'release_requested')
  assert.ok(released.every((r) => r.status === 'succeeded'))
  await captureScreenshot(page, 'artifacts/apple-review-mobile.png')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await captureScreenshot(page, 'artifacts/apple-review-desktop.png')
  // 后续既有 Android 冒烟从应用页签导航继续，避免 Apple 表单影响原验收状态。
  await openReleasePlanWorkspace(page)
}
