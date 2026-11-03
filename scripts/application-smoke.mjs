/** @description 应用与绑定的浏览器验收，包含持久化、错误保稿、版本冲突和窄屏检查。 */
import assert from 'node:assert/strict'

/** 全页截图前回到顶端并等待布局提交，避免 sticky 导航留在旧滚动位置。 */
export async function captureScreenshot(page, path) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        window.scrollTo(0, 0)
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      }),
  )
  await page.screenshot({ path, fullPage: true })
}

/** 使用隔离服务与合成目标，只维护公开配置，绝不提交真实商店。 */
export async function runApplicationSmoke(page, origin) {
  // 1. 创建 Android 身份与独立商店目标，刷新必须保留 URL 定位和数据。
  await page.getByRole('button', { name: '新建应用', exact: true }).click()
  await page.getByLabel('应用名称', { exact: true }).fill('验收 Android')
  await page.getByLabel('Android 包名', { exact: true }).fill('com.example.smoke')
  await page.getByRole('button', { name: '创建应用', exact: true }).click()
  await page.getByRole('heading', { name: '验收 Android', exact: true }).waitFor()
  await page.getByRole('button', { name: '添加商店绑定' }).click()
  await page.getByLabel('商店 appId', { exact: true }).fill('100001')
  await page.getByLabel('凭据引用', { exact: true }).fill('smoke-huawei')
  await page.getByRole('button', { name: '保存绑定', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '商店绑定已保存' }).waitFor()
  await page.reload()
  await page.getByRole('heading', { name: '验收 Android', exact: true }).waitFor()
  await page.getByText('smoke-huawei', { exact: true }).waitFor()
  assert.ok(new URL(page.url()).searchParams.get('application'))
  await captureScreenshot(page, 'artifacts/application-desktop.png')

  // 2. 重复身份由服务端拒绝，失败仍保留输入；取消后焦点返回新建入口。
  await page.getByRole('button', { name: '新建应用', exact: true }).click()
  await page.getByLabel('应用名称', { exact: true }).fill('保留重复草稿')
  await page.getByLabel('Android 包名', { exact: true }).fill('com.example.smoke')
  await page.getByRole('button', { name: '创建应用', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '已登记相同平台' }).waitFor()
  assert.equal(await page.getByLabel('应用名称', { exact: true }).inputValue(), '保留重复草稿')
  await page.getByRole('button', { name: '取消', exact: true }).click()
  assert.ok(
    await page
      .getByRole('button', { name: '新建应用', exact: true })
      .evaluate((element) => element === document.activeElement),
  )

  // 3. 模拟另一编辑者修改配置，旧版本不能覆盖；刷新只更新事实，草稿仍由用户核对。
  await page.getByRole('button', { name: '编辑绑定', exact: true }).click()
  await page.getByLabel('凭据引用', { exact: true }).fill('local-draft')
  const url = new URL(page.url())
  const root = `${origin}/api/projects/${url.searchParams.get('project')}/applications/${url.searchParams.get('application')}/bindings`
  const saved = (await (await fetch(root)).json()).items[0]
  const changed = await fetch(`${root}/${saved.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appId: saved.appId,
      credentialReference: 'other-editor',
      expectedRevision: saved.revision,
    }),
  })
  assert.equal(changed.status, 200)
  await page.getByRole('button', { name: '保存绑定', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '配置已被修改' }).waitFor()
  assert.equal(await page.getByLabel('凭据引用', { exact: true }).inputValue(), 'local-draft')
  await page.getByRole('button', { name: '刷新当前配置' }).click()
  await page.getByRole('button', { name: '已核对，使用版本 2' }).waitFor()
  assert.equal(await page.getByLabel('凭据引用', { exact: true }).inputValue(), 'local-draft')
  await page.getByRole('button', { name: '已核对，使用版本 2' }).click()
  await page.getByRole('button', { name: '保存绑定', exact: true }).click()
  await page.getByText('local-draft', { exact: true }).waitFor()
  const final = (await (await fetch(root)).json()).items[0]
  assert.equal(final.revision, 3)
  assert.equal(final.verification, 'not_checked')

  // 4. iOS 使用独立 Bundle ID 和 Apple 目标；浏览器后退恢复之前应用。
  await page.getByRole('button', { name: '新建应用', exact: true }).click()
  await page.getByLabel('应用名称', { exact: true }).fill('验收 iOS')
  await page.getByLabel('应用平台', { exact: true }).click()
  // 使用真实键盘选择，兼容 Select 虚拟列表的可访问镜像节点。
  await page.getByLabel('应用平台', { exact: true }).press('ArrowDown')
  await page.getByLabel('应用平台', { exact: true }).press('Enter')
  await page.getByLabel('iOS Bundle ID', { exact: true }).fill('com.example.ios')
  await page.getByRole('button', { name: '创建应用', exact: true }).click()
  await page.getByRole('heading', { name: '验收 iOS', exact: true }).waitFor()
  await page.getByRole('button', { name: '添加商店绑定' }).click()
  await page.getByLabel('商店 appId', { exact: true }).fill('200002')
  await page.getByLabel('凭据引用', { exact: true }).fill('smoke-apple')
  await page.getByRole('button', { name: '保存绑定', exact: true }).click()
  await page.getByText('smoke-apple', { exact: true }).waitFor()
  await page.goBack()
  await page.getByRole('heading', { name: '验收 Android', exact: true }).waitFor()
  await page.getByText('local-draft', { exact: true }).waitFor()
  await page.setViewportSize({ width: 390, height: 844 })
  await captureScreenshot(page, 'artifacts/application-mobile.png')
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    '应用页窄屏溢出',
  )
  await page.setViewportSize({ width: 1440, height: 1000 })
}
