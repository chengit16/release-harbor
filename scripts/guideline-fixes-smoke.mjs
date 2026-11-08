/** @description 指定六项体验修复的 Chrome 回归；合成目录与只读路由，不读真实材料，不访问商店。 */
import assert from 'node:assert/strict'
import { captureScreenshot } from './capture-screenshot.mjs'

/** 核对草稿、校验焦点、URL 定位、分页请求数量与窄屏标题；所有测试路由在结束后移除。
 * 长函数保留原因：同一浏览器窗口验证内存草稿及历史恢复，阶段分别保留可定位的行为断言。 */
export async function runGuidelineFixesSmoke(page, origin) {
  const mutations = [],
    bindingReads = []
  const observer = (request) => {
    const path = new URL(request.url()).pathname
    if (path.startsWith('/api/') && request.method() !== 'GET') mutations.push(path)
    if (/\/bindings$/.test(path)) bindingReads.push(path)
  }
  page.on('request', observer)
  // 1. 只替换本机公开目录，60 个应用不得一次挂载全部卡片或请求全部绑定。
  const projects = (await (await fetch(origin + '/api/projects')).json()).items
  const project = projects[0]
  assert.ok(project)
  const apps = Array.from({ length: 60 }, (_, index) => ({
    id: `00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`,
    workspaceId: 'local',
    projectId: project.id,
    name: `分页合成应用 ${index + 1}`,
    identifier: `com.example.guidelines${index + 1}`,
    platform: 'android',
    createdAt: new Date().toISOString(),
  }))
  const directoryPattern = '**/api/projects/*/applications'
  const bindingPattern = '**/api/projects/*/applications/*/bindings'
  await page.route(directoryPattern, (route) =>
    route.fulfill({
      json: { items: new URL(route.request().url()).pathname.includes(project.id) ? apps : [] },
    }),
  )
  await page.route(bindingPattern, (route) => route.fulfill({ json: { items: [] } }))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(origin + '/?view=projects')
  const cards = page.locator('.application-list > .ant-card')
  await cards.first().waitFor()
  await page.waitForLoadState('networkidle')
  assert.equal(await cards.count(), 12)
  assert.equal(bindingReads.length, 12, '首屏只读取当前页的 12 份绑定摘要')
  await page.getByTitle('下一页', { exact: true }).click()
  await page.getByRole('heading', { name: '分页合成应用 13', exact: true }).waitFor()
  assert.equal(new URL(page.url()).searchParams.get('applicationPage'), '2')
  await page.reload()
  await page.getByRole('heading', { name: '分页合成应用 13', exact: true }).waitFor()
  assert.equal(await page.getByRole('heading', { name: /全部应用/, level: 2 }).count(), 1)
  // 2. 站内往返保留公开草稿；刷新取消留在原页，明确取消清理草稿。
  await page.getByRole('button', { name: '新建应用', exact: true }).click()
  await page.getByLabel('应用名称', { exact: true }).fill('站内往返合成草稿')
  await page.getByRole('menuitem', { name: '商店账号', exact: true }).click()
  await page.getByRole('heading', { name: '商店账号', exact: true }).waitFor()
  await page.getByRole('menuitem', { name: '应用管理', exact: true }).click()
  await page.getByRole('button', { name: '新建应用', exact: true }).click()
  assert.equal(await page.getByLabel('应用名称', { exact: true }).inputValue(), '站内往返合成草稿')
  const existingDialogs = page.listeners('dialog')
  page.removeAllListeners('dialog')
  const blocked = page.waitForEvent('dialog')
  const reload = page.reload().catch(() => undefined)
  const dialog = await blocked
  assert.equal(dialog.type(), 'beforeunload')
  await dialog.dismiss()
  await reload
  for (const listener of existingDialogs) page.on('dialog', listener)
  assert.equal(await page.getByLabel('应用名称', { exact: true }).inputValue(), '站内往返合成草稿')
  await page.getByRole('button', { name: /^取\s*消$/ }).click()
  await page.getByRole('button', { name: '新建应用', exact: true }).click()
  assert.equal(await page.getByLabel('应用名称', { exact: true }).inputValue(), '')
  await page.getByRole('button', { name: '保存并配置渠道', exact: true }).click()
  await page.waitForFunction(() => document.activeElement?.id === 'name')
  await page.getByRole('button', { name: /^取\s*消$/ }).click()
  // 3. 手机不自动抢输入焦点；提交错误主动定位首字段，标题层级及分页不溢出。
  await page.setViewportSize({ width: 375, height: 812 })
  await page.getByRole('button', { name: '新建项目', exact: true }).click()
  assert.notEqual(await page.evaluate(() => document.activeElement?.id), 'project_name')
  await page.getByRole('button', { name: '创建项目', exact: true }).click()
  await page.waitForFunction(() => document.activeElement?.id === 'project_name')
  await captureScreenshot(page, 'artifacts/guidelines-validation-375.png')
  await page.getByRole('button', { name: /^取\s*消$/ }).click()
  for (const width of [1440, 375, 844]) {
    await page.setViewportSize({ width, height: width === 844 ? 390 : 900 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await captureScreenshot(page, `artifacts/guidelines-directory-${width}.png`)
  }
  await page.unroute(directoryPattern)
  await page.unroute(bindingPattern)
  // 4. 渠道筛选和维护抽屉刷新恢复；空向导校验只定位字段，不发送配置请求。
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(origin + '/?view=accounts&accountChannel=huawei')
  const filter = page.getByRole('combobox', { name: '账号渠道筛选', exact: true })
  await filter.waitFor()
  await page.reload()
  assert.equal(new URL(page.url()).searchParams.get('accountChannel'), 'huawei')
  const manage = page.getByRole('button', { name: /^(管理|维护)账号 / }).first()
  await manage.click()
  const detail = new URL(page.url()).searchParams.get('accountDetail')
  assert.ok(detail)
  await page.reload()
  await page.getByRole('dialog', { name: '账号维护', exact: true }).waitFor()
  await page.getByRole('button', { name: '关闭账号维护', exact: true }).click()
  await page.getByRole('button', { name: '新增商店账号', exact: true }).click()
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  await page.waitForFunction(() => document.activeElement?.id === 'credential-setup_displayName')
  await page.getByRole('button', { name: /^取\s*消$/ }).click()
  // 5. 存储 URL 筛选和分页刷新恢复，返回筛选会清空临时勾选和清理确认。
  const storagePattern = '**/api/local/storage'
  const storage = {
    usedBytes: 20,
    budgetBytes: 1024,
    availableBytes: 4096,
    backupBytes: 0,
    artifacts: apps.slice(0, 20).map((app, index) => ({
      id: app.id,
      projectId: project.id,
      applicationId: app.id,
      applicationName: app.name,
      fileName: `synthetic-${index}.apk`,
      version: '1.0',
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'ready',
      sizeBytes: 1,
      references: 0,
    })),
  }
  await page.route(storagePattern, (route) => route.fulfill({ json: storage }))
  await page.goto(origin + '/?view=settings&storageStatus=ready&storageDays=7&storagePage=2')
  const storageRegion = page.getByRole('region', { name: '安装包存储管理', exact: true })
  await storageRegion.getByText('synthetic-8.apk', { exact: true }).waitFor()
  await page.reload()
  await storageRegion.getByText('synthetic-8.apk', { exact: true }).waitFor()
  await storageRegion.getByRole('textbox', { name: '搜索安装包', exact: true }).fill('synthetic-1')
  assert.equal(new URL(page.url()).searchParams.get('storagePage'), null)
  await page.reload()
  assert.equal(
    await storageRegion.getByRole('textbox', { name: '搜索安装包', exact: true }).inputValue(),
    'synthetic-1',
  )
  await page.unroute(storagePattern)
  // 6. 跟踪任务页码恢复；公开说明可返回恢复，产物和定时时刻不跨导航复用。
  const localPattern = '**/api/local'
  const local = await (await fetch(origin + '/api/local')).json()
  local.state.follows = apps.slice(0, 20).map((app, index) => ({
    id: app.id,
    projectId: project.id,
    applicationId: app.id,
    bindingId: app.id,
    label: `合成跟踪 ${index + 1}`,
    fingerprint: 'a'.repeat(64),
    versionId: null,
    buildNumber: null,
    intervalMinutes: 30,
    until: 'review',
    status: 'paused',
    reason: '专项只读分页',
    nextAt: '2026-11-08T00:00:00.000Z',
    expiresAt: '2026-11-09T00:00:00.000Z',
    lastAt: null,
    failures: 0,
    baseline: {},
  }))
  await page.route(localPattern, (route) => route.fulfill({ json: local }))
  await page.goto(origin + '/?view=reviews&reviewMode=follows&followPage=2')
  await page.getByText('合成跟踪 9', { exact: true }).waitFor()
  await page.reload()
  await page.getByText('合成跟踪 9', { exact: true }).waitFor()
  await page.getByRole('textbox', { name: '搜索跟踪任务', exact: true }).fill('合成跟踪 1')
  assert.equal(new URL(page.url()).searchParams.get('followPage'), null)
  await page.unroute(localPattern)
  const binding = {
    id: apps[0].id,
    projectId: project.id,
    applicationId: apps[0].id,
    workspaceId: 'local',
    channel: 'huawei',
    appId: 'synthetic-target',
    credentialReference: 'synthetic',
    revision: 1,
    createdAt: apps[0].createdAt,
    updatedAt: apps[0].createdAt,
  }
  const releasePattern = '**/api/projects/*/applications/*/*'
  await page.route(directoryPattern, (route) => route.fulfill({ json: { items: apps } }))
  await page.route(releasePattern, (route) =>
    route.fulfill({
      json: {
        items: new URL(route.request().url()).pathname.endsWith('/bindings') ? [binding] : [],
      },
    }),
  )
  const releaseUrl = `${origin}/?view=releases&releaseTask=workspace&project=${project.id}&application=${apps[0].id}`
  await page.goto(releaseUrl)
  const notes = page.getByRole('textbox', { name: '更新说明', exact: true })
  await notes.fill('不包含授权的合成发布说明')
  await page.getByRole('menuitem', { name: '商店账号', exact: true }).click()
  await page.getByRole('heading', { name: '商店账号', exact: true }).waitFor()
  await page.goBack()
  assert.equal(await notes.inputValue(), '不包含授权的合成发布说明')
  assert.equal(
    await page.getByRole('combobox', { name: '发布安装包', exact: true }).inputValue(),
    '',
  )
  assert.deepEqual(
    await page.evaluate(() =>
      [...Object.values(localStorage), ...Object.values(sessionStorage)].filter((value) =>
        value.includes('合成发布说明'),
      ),
    ),
    [],
  )
  // 更改测试上下文前显式允许丢弃内存草稿，不触发任何准备或执行。
  await page.goto(origin + '/?view=projects')
  await page.unroute(directoryPattern)
  await page.unroute(releasePattern)
  page.off('request', observer)
  assert.deepEqual(mutations, [], '体验修复回归仅允许本机 GET')
  console.log(
    '指定六项 Chrome 回归通过：站内草稿／刷新拦截／明确取消、首错焦点、手机不自动聚焦、账号筛选与详情、存储筛选分页恢复、60 应用每页 12 份摘要、标题层级及三视口布局；零业务写入。',
  )
}
