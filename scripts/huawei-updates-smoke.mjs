/** @description 隔离 Chrome 验证华为动作选择、不可变摘要和一次确认；只使用合成执行端口。 */
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { syntheticApk } from '../tests/fixtures/apk.ts'
import { captureScreenshot } from './capture-screenshot.mjs'
import { openReleasePlanWorkspace } from './release-center-smoke.mjs'

/** 完整用户路径保留在同一场景，保护切换、刷新和手机表单；不触发真实商店。 */
export async function runHuaweiUpdatesSmoke(page, origin, dataRoot) {
  // 1. 固定隔离项目复用合成华为账号，接入不同身份的合成 APK。
  const url = new URL(page.url()),
    base = `${origin}/api/projects/${url.searchParams.get('project')}/applications`
  const apps = (await (await fetch(base)).json()).items
  const existing = apps.find((a) => a.name === '合成执行验收')
  assert.ok(existing)
  const binding = (await (await fetch(`${base}/${existing.id}/bindings`)).json()).items[0]
  const created = await fetch(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: '华为正式送审验收',
      platform: 'android',
      identifier: 'com.example.huawei',
    }),
  })
  assert.equal(created.status, 201)
  const raw = await created.json(),
    application = raw.application ?? raw,
    root = `${base}/${application.id}`
  assert.equal(
    (
      await fetch(root + '/bindings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          channel: 'huawei',
          appId: '999997',
          credentialReference: binding.credentialReference,
        }),
      })
    ).status,
    201,
  )
  const apk = await syntheticApk(dataRoot, 'com.example.huawei')
  assert.ok(apk)
  assert.equal(
    (
      await fetch(root + '/artifacts', {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          'x-artifact-name': 'synthetic-huawei.apk',
          'x-artifact-size': String(apk.length),
        },
        body: apk,
      })
    ).status,
    202,
  )
  for (let n = 0; n < 100; n++) {
    if ((await (await fetch(root + '/artifacts')).json()).items[0]?.status === 'ready') break
    await delay(100)
  }
  url.searchParams.set('application', application.id)
  url.searchParams.set('tab', 'plans')
  await page.goto(url.href)
  await openReleasePlanWorkspace(page)
  const panel = page.getByRole('region', { name: '发布计划', exact: true })
  for (const label of ['发布渠道', '发布安装包']) {
    const select = panel.getByRole('combobox', { name: label, exact: true })
    await select.click()
    await select.press('ArrowDown')
    await select.press('Enter')
  }
  // 2. 默认草稿，显式切换后才能准备新送审动作；三种屏宽核对表单和操作区域。
  assert.ok(await panel.getByRole('radio', { name: '保存草稿', exact: true }).isChecked())
  await panel.getByRole('radio', { name: '提交审核', exact: true }).check()
  await panel.getByLabel('更新说明', { exact: true }).fill('华为默认语言更新说明合成验收')
  // 输入框焦点会在视口变化时滚动页面；先结束输入，再等待两帧，几何比较使用稳定布局。
  await panel.getByLabel('更新说明', { exact: true }).blur()
  for (const width of [1440, 375, 844]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      '华为送审表单溢出',
    )
    const breadcrumb = await page
      .getByRole('link', { name: '发布中心', exact: true })
      .evaluate((element) => {
        const range = document.createRange()
        range.selectNodeContents(element)
        return range.getBoundingClientRect().x
      })
    const title = await page.locator('.release-workspace h1').first().boundingBox()
    const tag = await page.locator('.release-workspace-header .ant-tag').boundingBox()
    const compact = width <= 991
    const back = await page
      .getByRole(compact ? 'link' : 'button', {
        name: compact ? '发布中心' : '返回发布列表',
        exact: true,
      })
      .boundingBox()
    const manage = await page
      .getByRole('button', { name: compact ? '更多应用操作' : '管理应用配置', exact: true })
      .boundingBox()
    assert.ok(title && tag && back && manage)
    assert.ok(Math.abs(breadcrumb - title.x) <= 2, '华为页头左边缘未对齐')
    assert.ok(Math.abs(title.y + title.height / 2 - tag.y - tag.height / 2) <= 2, '平台标签未居中')
    if (!compact) {
      assert.ok(
        Math.abs(back.y + back.height / 2 - manage.y - manage.height / 2) <= 2,
        `页头按钮未居中：${JSON.stringify({ width, back, manage })}`,
      )
    }

    const fields = panel.getByRole('radio', { name: '保存草稿', exact: true })
    assert.ok(await fields.isVisible())
    await captureScreenshot(page, `artifacts/huawei-submit-form-${width}.png`)
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await panel.getByRole('button', { name: '准备发布', exact: true }).click()
  const summary = page.getByRole('dialog', { name: '发布摘要', exact: true })
  await summary
    .getByRole('region', { name: '本次资料与策略范围', exact: true })
    .getByText('资料写入范围', { exact: true })
    .waitFor()
  await summary.waitFor()
  await summary.getByText(/在架版本 1.0.0/).waitFor()
  assert.equal(
    await summary.getByRole('button', { name: '确认提交审核', exact: true }).isEnabled(),
    false,
  )
  assert.equal((await (await fetch(root + '/release-attempts')).json()).items.length, 0)
  for (const width of [1440, 375, 844]) {
    await page.setViewportSize({ width, height: 1000 })
    assert.ok(await summary.evaluate((e) => e.scrollWidth <= e.clientWidth), '华为送审摘要溢出')
    await captureScreenshot(page, `artifacts/huawei-submit-summary-${width}.png`)
  }
  // 3. 关闭不授权，确认只派发一次；刷新保留回执且不能重新上传。
  await summary.getByRole('button', { name: '关闭发布摘要', exact: true }).click()
  await summary.waitFor({ state: 'hidden' })
  await panel.getByRole('button', { name: '查看发布摘要', exact: true }).click()
  await summary.getByRole('checkbox').check()
  await summary.getByRole('button', { name: '确认提交审核', exact: true }).click()
  await summary.waitFor({ state: 'hidden' })
  await page
    .getByText('华为已受理版本审核提交；不代表审核通过或已上架', { exact: true })
    .first()
    .waitFor()
  await page.reload()
  await page
    .getByText('华为已受理版本审核提交；不代表审核通过或已上架', { exact: true })
    .first()
    .waitFor()
  const attempts = (await (await fetch(root + '/release-attempts')).json()).items
  assert.equal(attempts.length, 1)
  assert.equal(attempts[0].code, 'huawei_review_submitted')
  await page.setViewportSize({ width: 1440, height: 1000 })
}
