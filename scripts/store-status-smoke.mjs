/** @description 独立商店查询浏览器验收；隔离绑定没有计划，合成官方响应不连接真实商店。 */
import assert from 'node:assert/strict'
import { runStoreTrackingSmoke } from './store-tracking-smoke.mjs'
import { runStoreQueryHistorySmoke } from './store-query-history-smoke.mjs'
import { captureScreenshot } from './capture-screenshot.mjs'

/** 官网版本不依赖本机发布；刷新、深链与前后退均不自动发起查询。 */
export async function runStoreStatusSmoke(page, origin) {
  // 1. 只建立商店绑定，不创建发布计划，保护官网查询与本机发布解耦的入口。
  const start = page.url(),
    url = new URL(start)
  const projectId = url.searchParams.get('project')
  const base = `${origin}/api/projects/${projectId}/applications`
  const created = await fetch(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: '官网发布应用',
      platform: 'android',
      identifier: 'com.example.external',
    }),
  })
  assert.equal(created.status, 201)
  const application = (await created.json()).application
  const bound = await fetch(`${base}/${application.id}/bindings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      channel: 'meizu',
      appId: '789012',
      credentialReference: 'synthetic-external-account',
    }),
  })
  assert.equal(bound.status, 201)
  const bindingId = (await bound.json()).binding.id
  const recordsBefore = await (await fetch(`${base}/${application.id}/release-plans`)).text()
  assert.equal(JSON.parse(recordsBefore).items.length, 0)
  // 2. 只在用户点击时派发查询，刷新和详情导航只能读取已有结果。
  let queries = 0
  const listener = (request) => {
    if (request.url().includes('/api/store-status/') && request.method() === 'POST') queries++
  }
  page.on('request', listener)
  url.search = new URLSearchParams({
    view: 'reviews',
    reviewProject: projectId,
    reviewApplication: application.id,
  }).toString()
  await page.goto(url.href)
  const region = page.getByRole('region', { name: '商店状态查询', exact: true })
  await region.getByText('找到 1 个商店绑定', { exact: true }).waitFor()
  assert.equal(queries, 0)
  await region.getByRole('button', { name: '查看详情', exact: true }).click()
  const detail = page.getByRole('dialog', { name: '商店状态详情', exact: true })
  await detail.getByText('尚未查询商店状态', { exact: true }).waitFor()
  await detail.getByRole('button', { name: '查询商店状态', exact: true }).click()
  await detail.getByText('3.0.0', { exact: true }).waitFor()
  // 3. 详情与摘要都在三种视口中核对完整标签、换行及页面左边缘。
  await detail.getByText('审核中', { exact: true }).waitFor()
  await detail
    .getByText(/商店未提供构建号/)
    .last()
    .waitFor()
  assert.equal(queries, 1)
  await page.reload()
  await detail.getByText('3.0.0', { exact: true }).waitFor()
  for (const width of [1440, 375, 844]) {
    await page.setViewportSize({ width, height: 900 })
    assert.ok(
      await detail.evaluate((element) => element.scrollWidth <= element.clientWidth),
      '商店详情溢出',
    )
    await captureScreenshot(page, `artifacts/store-status-detail-${width}.png`)
  }
  await detail.getByRole('button', { name: '关闭商店详情', exact: true }).click()
  for (const width of [1440, 375, 844]) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      '商店目录横向溢出',
    )
    const heading = await page.getByRole('heading', { name: '审核状态', exact: true }).boundingBox()
    const content = await region.boundingBox()
    assert.ok(heading && content && Math.abs(heading.x - content.x) <= 2, '商店目录未与标题对齐')
    await assertStatusTag(region, '审核中')
    assert.equal(
      await region.getByText('已被新版本替代', { exact: true }).count(),
      0,
      '历史替代状态不进入主摘要',
    )
    await captureScreenshot(page, `artifacts/store-status-list-${width}.png`)
  }
  await page.goBack()
  await detail.getByText('3.0.0', { exact: true }).waitFor()
  await page.goForward()
  await region.getByText('找到 1 个商店绑定', { exact: true }).waitFor()
  assert.equal(queries, 1)
  assert.equal(await (await fetch(`${base}/${application.id}/release-plans`)).text(), recordsBefore)
  // 4. 目录传输失败不能显示成没有绑定；恢复只重读缓存，不重发商店请求。
  await page.route('**/api/store-status', (route) =>
    route.fulfill({ status: 503, json: { message: '合成目录读取失败' } }),
  )
  await page.reload()
  await region.getByText('商店目录读取失败', { exact: true }).waitFor()
  assert.equal(await region.getByText('找到 0 个商店绑定', { exact: true }).count(), 0)
  await page.unroute('**/api/store-status')
  await region.getByRole('button', { name: '刷新商店目录', exact: true }).click()
  await region.getByText('找到 1 个商店绑定', { exact: true }).waitFor()
  assert.equal(queries, 1)
  page.off('request', listener)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await runChannelStatusSmoke(page, origin, base, application, projectId)
  await runStoreTrackingSmoke(page, origin, projectId)
  await runApplicationFilterSmoke(page, origin, projectId, application)
  await runStoreQueryHistorySmoke(page, origin, projectId, application, bindingId)
  await page.goto(start)
}

// 同名应用必须按平台和项目辨认；多商店只增加绑定，不能重复增加应用选项。
async function runApplicationFilterSmoke(page, origin, projectId, android) {
  // 1. 同一项目建立同名三平台应用，另一个项目再建立同名 Android 应用。
  const other = await fetch(`${origin}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: '同名应用验收项目',
      key: 'same-name-filter',
      framework: 'react-native',
    }),
  })
  assert.equal(other.status, 201)
  const otherProjectId = (await other.json()).project.id
  const applications = [{ projectId, application: android, platform: 'Android' }]
  for (const [owner, platform, label, channel] of [
    [projectId, 'ios', 'iOS', 'app_store'],
    [projectId, 'harmony', 'HarmonyOS', 'harmony'],
    [otherProjectId, 'android', 'Android', 'meizu'],
  ]) {
    const base = `${origin}/api/projects/${owner}/applications`
    const created = await fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: android.name,
        platform,
        identifier: `com.example.same.${platform}`,
      }),
    })
    assert.equal(created.status, 201)
    const application = (await created.json()).application
    const bound = await fetch(`${base}/${application.id}/bindings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channel, appId: '789013', credentialReference: 'synthetic-filter' }),
    })
    assert.equal(bound.status, 201)
    applications.push({ projectId: owner, application, platform: label })
  }
  // 2. 各平台可独立选择，筛选 URL 保存原 ID；刷新恢复且不请求商店。
  const writes = []
  const listener = (request) => {
    if (request.url().startsWith(`${origin}/api/`) && request.method() !== 'GET')
      writes.push(request.url())
  }
  page.on('request', listener)
  const url = new URL(origin)
  url.search = new URLSearchParams({ view: 'reviews', reviewProject: projectId }).toString()
  await page.goto(url.href)
  const region = page.getByRole('region', { name: '商店状态查询', exact: true })
  const select = region.getByRole('combobox', { name: '审核筛选应用', exact: true })
  for (const entry of applications.filter((item) => item.projectId === projectId)) {
    await select.click()
    // 全量冒烟有较多既存应用，先搜索再定位，兼容 Select 的虚拟列表。
    await select.fill(android.name)
    const label = `${android.name} · ${entry.platform}`
    const option = page.locator('.ant-select-dropdown:visible').getByText(label, { exact: true })
    await option.waitFor()
    assert.equal(await option.count(), 1, '同一应用的多个商店不应生成重复选项')
    await option.click()
    assert.equal(new URL(page.url()).searchParams.get('reviewApplication'), entry.application.id)
    await page.reload()
    await region.getByText(label, { exact: true }).waitFor()
  }
  // 3. 全项目下显示项目归属；搜索平台可用，三种视口的下拉层不得越过页面。
  await region.getByRole('button', { name: '重置查询筛选', exact: true }).click()
  for (const width of [1440, 375, 844]) {
    await page.setViewportSize({ width, height: 900 })
    if (width <= 760) await region.getByRole('button', { name: /^筛选条件/ }).click()
    await select.click()
    await select.fill(android.name)
    const dropdown = page.locator('.ant-select-dropdown:visible')
    await dropdown
      .getByText(`同名应用验收项目 / ${android.name} · Android`, { exact: true })
      .waitFor()
    assert.ok(
      await dropdown
        .locator('.store-status-application-option')
        .evaluateAll((elements) =>
          elements.every(
            (element) =>
              element.scrollWidth <= element.clientWidth &&
              getComputedStyle(element).whiteSpace === 'normal',
          ),
        ),
      '应用名称、项目和平台必须完整换行展示',
    )
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await captureScreenshot(page, `artifacts/store-status-application-filter-${width}.png`)
    await page.keyboard.press('Escape')
  }
  await select.fill('HarmonyOS')
  const option = page.locator('.ant-select-dropdown:visible').getByText(new RegExp(android.name))
  await option.waitFor()
  assert.equal(await option.count(), 1)
  await option.click()
  assert.equal(
    new URL(page.url()).searchParams.get('reviewApplication'),
    applications[2].application.id,
  )
  assert.deepEqual(writes, [], '应用筛选、刷新和搜索不能触发商店查询或写入')
  page.off('request', listener)
  await page.setViewportSize({ width: 1440, height: 1000 })
}

// 这些合成绑定只验证页面语义；真实账号不会进入浏览器验收服务。
async function runChannelStatusSmoke(page, origin, base, application, projectId) {
  // 1. 各渠道使用隔离绑定，显式筛选避免不同商店的同名状态干扰断言。
  for (const channel of ['xiaomi', 'huawei', 'oppo', 'tencent', 'app_store']) {
    let target = application
    if (channel === 'app_store') {
      const created = await fetch(base, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'iOS 状态回归',
          platform: 'ios',
          identifier: 'com.example.statusios',
        }),
      })
      assert.equal(created.status, 201)
      target = (await created.json()).application
    }
    const bound = await fetch(`${base}/${target.id}/bindings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        channel,
        appId: ['xiaomi', 'oppo'].includes(channel) ? target.identifier : '789012',
        credentialReference: 'synthetic-status-account',
      }),
    })
    assert.equal(bound.status, 201)
    const binding = (await bound.json()).binding
    const url = new URL(origin)
    url.search = new URLSearchParams({
      view: 'reviews',
      reviewProject: projectId,
      reviewApplication: target.id,
      reviewTarget: binding.id,
      reviewChannel: channel,
    }).toString()
    await page.goto(url.href)
    // 2. 区分查询失败、公开在架、新旧版本和没有版本关联的审核流程。
    const detail = page.getByRole('dialog', { name: '商店状态详情', exact: true })
    await detail.getByRole('button', { name: '查询商店状态', exact: true }).click()
    if (channel === 'app_store') {
      await detail.getByText('本次查询失败', { exact: true }).waitFor()
      await detail.getByText(/商店拒绝了查询请求/).waitFor()
    } else if (channel === 'xiaomi') {
      await detail.getByText('公开在架', { exact: true }).waitFor()
      await detail.getByText(/不代表当前送审版本审核通过/).waitFor()
    } else if (channel === 'huawei') {
      await detail.getByText('审核中', { exact: true }).waitFor()
      await detail.getByText('已上架', { exact: true }).first().waitFor()
      await detail.getByText('2.0.0', { exact: true }).waitFor()
    } else if (channel === 'oppo') {
      await assertStatusTag(detail, '审核未通过')
    } else {
      await detail.getByText('当前审核流程（官方未返回对应版本）', { exact: true }).waitFor()
      await detail.getByText('审核通过', { exact: true }).waitFor()
      await detail.getByText('已读取版本资料，审核未确认', { exact: true }).waitFor()
    }
    // 3. 同一结论在详情保留每个版本，在摘要去重；两处都要保留完整标签文字。
    for (const width of [1440, 375, 844]) {
      await page.setViewportSize({ width, height: 900 })
      assert.ok(
        await detail.evaluate((element) => element.scrollWidth <= element.clientWidth),
        `${channel} 详情溢出`,
      )
      await captureScreenshot(page, `artifacts/store-status-${channel}-${width}.png`)
    }
    await detail.getByRole('button', { name: '关闭商店详情', exact: true }).click()
    const region = page.getByRole('region', { name: '商店状态查询', exact: true })
    for (const width of [1440, 375, 844]) {
      await page.setViewportSize({ width, height: 900 })
      const label =
        channel === 'app_store'
          ? '本次查询失败'
          : channel === 'xiaomi'
            ? '公开在架'
            : channel === 'oppo'
              ? '审核未通过'
              : channel === 'huawei'
                ? '审核中'
                : '审核通过'
      await assertStatusTag(region, label)
      if (channel === 'huawei') {
        await assertStatusTag(region, '已上架')
        assert.equal(
          await region
            .getByText('已上架', { exact: true })
            .and(region.locator('.store-version-status-tag'))
            .count(),
          1,
          '摘要未去重',
        )
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await captureScreenshot(page, `artifacts/store-status-${channel}-summary-${width}.png`)
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
  }
}

// 状态既要使用 Ant Design 标签，也要保留完整文字，长状态在手机和窄列中不能裁切。
async function assertStatusTag(scope, label) {
  const tag = scope
    .getByText(label, { exact: true })
    .and(scope.locator('.store-version-status-tag'))
  await tag.waitFor()
  assert.ok(
    await tag.evaluate((element) => element.classList.contains('ant-tag')),
    '状态未使用标签',
  )
  assert.ok(
    await tag.evaluate((element) => element.scrollWidth <= element.clientWidth),
    '状态标签文字溢出',
  )
}
