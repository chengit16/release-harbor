/** @description 使用独立端口和临时目录验收工作台与应用配置，不污染用户数据。 */
import { openWorkbenchPage } from './navigation-state.mjs'
import { runGuidelineFixesSmoke } from './guideline-fixes-smoke.mjs'
import { runUrlNavigationSmoke } from './url-navigation-smoke.mjs'
import { runCritiqueFixesSmoke } from './critique-fixes-smoke.mjs'
import { runWorkbenchDesignSmoke } from './workbench-design-smoke.mjs'
import { runUsabilitySmoke } from './usability-smoke.mjs'
import { runLocalProductivitySmoke } from './local-productivity-smoke.mjs'
import { runLocalEfficiencySmoke } from './local-efficiency-smoke.mjs'
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { runHuaweiUpdatesSmoke } from './huawei-updates-smoke.mjs'
import { runStoreStatusSmoke } from './store-status-smoke.mjs'
import { runMeizuObservationSmoke } from './meizu-observation-smoke.mjs'
import { runReleaseObservationSmoke } from './release-observation-smoke.mjs'
import { runReleaseBatchesSmoke } from './release-batches-smoke.mjs'
import { runBatchSettingsSmoke } from './batch-settings-smoke.mjs'
import { runFinalChannelsSmoke } from './tencent-harmony-smoke.mjs'
import { runAppleReviewSmoke } from './apple-review-smoke.mjs'
import { runIssuesSmoke } from './issues-smoke.mjs'
import { runBindingsLayoutSmoke } from './bindings-layout-smoke.mjs'
import { runStoreUpdatesSmoke } from './store-updates-smoke.mjs'
import { runVivoSmoke } from './vivo-smoke.mjs'
import { runOppoSmoke } from './oppo-smoke.mjs'
import { runXiaomiSmoke } from './xiaomi-smoke.mjs'
import { captureScreenshot, runApplicationSmoke } from './application-smoke.mjs'
import { runArtifactSmoke } from './artifact-smoke.mjs'
import { runAccountManagementSmoke } from './credential-account-smoke.mjs'
import { runAccountCardsSmoke } from './account-cards-smoke.mjs'
import { runReleaseCenterSmoke, runReleaseCenterHistorySmoke } from './release-center-smoke.mjs'
import { runPreflightSmoke } from './preflight-smoke.mjs'
import { runReleasePlanSmoke, runExecutionSmoke } from './release-plan-smoke.mjs'

// 浏览器验收使用独立端口和临时存储，不污染用户的默认项目数据。
const data = await mkdtemp(join(tmpdir(), 'release-harbor-ui-'))
// 并行验收可显式隔离端口，避免误连其他测试宿主并混用合成数据。
const port = process.env.RELEASE_HARBOR_SMOKE_PORT || '4401'
if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535)
  throw new Error('浏览器验收端口必须为 1024 至 65535 的整数')
const origin = `http://127.0.0.1:${port}`
const child = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/workbench-server.ts'], {
  env: {
    ...process.env,
    RELEASE_HARBOR_DATA_DIR: data,
    RELEASE_HARBOR_PORT: port,
    RELEASE_HARBOR_MODE: 'local',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
child.stdout.on('data', (chunk) => {
  output += chunk
})
child.stderr.on('data', (chunk) => {
  output += chunk
})
let browser
try {
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(output)
    try {
      ready = (await fetch(origin + '/api/health')).ok
    } catch {}
    if (ready) break
    await delay(100)
  }
  assert.ok(ready, '本机测试 API 未及时启动：' + output)
  // 浏览器尚未进入页面时也必须有明确期限，不把启动挂起误记成页面失败。
  await runLocalEfficiencySmoke()
  browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: 30000 })
  // 显式上下文允许导航回归打开第二个标签页，不能使用仅限单页的便捷上下文。
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  })
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  page.on('dialog', (dialog) => {
    if (dialog.type() === 'beforeunload') void dialog.accept()
    else void dialog.dismiss()
  })
  const credentialLeaks = []
  let materialRequests = 0
  page.on('request', (request) => {
    const body = request.postData() || ''
    const url = new URL(request.url())
    if (body.includes('synthetic-browser-secret') || body.includes('BEGIN PRIVATE KEY')) {
      materialRequests++
      if (url.hostname !== '127.0.0.1' || !/^\/v1\/sessions\/[^/]+\/profile$/.test(url.pathname))
        credentialLeaks.push(url.pathname)
    }
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openWorkbenchPage(page, origin + '/?view=projects')
  await page.getByRole('region', { name: '全部应用', exact: true }).waitFor()
  await mkdir('artifacts', { recursive: true })
  await captureScreenshot(page, 'artifacts/workspace-empty.png')
  await page.getByRole('button', { name: '新建项目', exact: true }).click()
  await page.getByLabel('项目名称', { exact: true }).fill('浏览器验收项目')
  await page.getByLabel('项目标识').fill('browser-smoke')
  await page.getByLabel('项目说明').fill('仅保存在隔离测试目录，退出后清理。')
  await page.getByRole('button', { name: '创建项目', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '项目已保存' }).waitFor()
  await page.reload()
  await page.getByRole('heading', { name: '浏览器验收项目', exact: true }).waitFor()
  const items = await (await fetch(origin + '/api/projects')).json()
  assert.equal(items.items.length, 1)
  assert.equal(items.items[0].key, 'browser-smoke')
  await captureScreenshot(page, 'artifacts/workspace.png')
  await runApplicationSmoke(page, origin)
  await runReleaseCenterSmoke(page)
  await runLocalProductivitySmoke(page, origin, data)
  await runArtifactSmoke(page, origin)
  await runPreflightSmoke(page, origin)
  await runReleasePlanSmoke(page, origin, data)
  await runAppleReviewSmoke(page, origin)
  await runExecutionSmoke(page, origin, data)
  await runHuaweiUpdatesSmoke(page, origin, data)
  await runXiaomiSmoke(page, origin, data)
  await runOppoSmoke(page, origin, data)
  await runVivoSmoke(page, origin, data)
  await runStoreUpdatesSmoke(page, origin, data, 'meizu')
  await runMeizuObservationSmoke(page, origin)
  await runStoreUpdatesSmoke(page, origin, data, 'honor')
  await runReleaseObservationSmoke(page, origin)
  await runFinalChannelsSmoke(page, origin, data, 'tencent')
  await runFinalChannelsSmoke(page, origin, data, 'harmony')
  await runReleaseBatchesSmoke(page, origin, data)
  await runBindingsLayoutSmoke(page, origin)
  await runReleaseCenterHistorySmoke(page, origin)
  await runStoreStatusSmoke(page, origin)
  await runIssuesSmoke(page, origin)
  await runAccountManagementSmoke(page, origin)
  await runAccountCardsSmoke(page, origin)
  await page.getByRole('menuitem', { name: '帮助与支持' }).click()
  await page.getByRole('tab', { name: '商店指南', exact: true }).click()
  await page.getByRole('heading', { name: '华为 AppGallery', exact: true }).waitFor()
  await captureScreenshot(page, 'artifacts/channels-desktop.png')
  await page.getByRole('tab', { name: '产品路线图', exact: true }).click()
  await page.getByRole('heading', { name: '本机团队工作台', exact: true }).waitFor()
  await page.getByText('工程完成 · 本机团队 T0–T4 已交付', { exact: true }).waitFor()
  assert.equal(await page.getByText('工程完成 · 渠道远端验收待做', { exact: true }).count(), 2)
  await page.getByText('第三至第五期交付范围与验收边界', { exact: true }).click()
  await page.getByText('第四期工程范围已完成', { exact: true }).waitFor()
  await page.getByText('第五期工程范围已完成（2026-11-11 交付）', { exact: true }).waitFor()
  await page.getByText('后续规划', { exact: true }).waitFor()
  assert.equal(await page.getByText('第五期实施中', { exact: true }).count(), 0)
  assert.equal(await page.getByText('第一期进行中', { exact: true }).count(), 0)
  await captureScreenshot(page, 'artifacts/roadmap-desktop.png')
  await page.setViewportSize({ width: 390, height: 844 })
  await captureScreenshot(page, 'artifacts/roadmap-mobile.png')
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    '路线图窄屏溢出',
  )
  await page.getByRole('tab', { name: '商店指南', exact: true }).click()
  await captureScreenshot(page, 'artifacts/channels-mobile.png')
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    '渠道页窄屏溢出',
  )
  await page.getByRole('button', { name: '打开工作台菜单', exact: true }).click()
  await page.getByRole('menuitem', { name: '应用管理' }).click()
  await captureScreenshot(page, 'artifacts/workspace-mobile.png')
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    '移动布局存在横向溢出',
  )
  await runUsabilitySmoke(page, origin)
  await runWorkbenchDesignSmoke(page, origin)
  await runCritiqueFixesSmoke(page, origin)
  await runGuidelineFixesSmoke(page, origin)
  await runUrlNavigationSmoke(page, origin)
  await runBatchSettingsSmoke(page, origin, data)
  assert.deepEqual(errors, [], '浏览器出现未处理错误')
  assert.deepEqual(credentialLeaks, [], '秘密材料不能发往控制面或其它接口')
  assert.ok(materialRequests >= 3, '华为和 Apple 材料应通过真实配置通道提交')
  assert.ok(
    await page.evaluate(
      () =>
        ![...Object.values(localStorage), ...Object.values(sessionStorage), location.href].some(
          (value) =>
            value.includes('synthetic-browser-secret') || value.includes('BEGIN PRIVATE KEY'),
        ),
    ),
    '浏览器持久化状态不能包含材料',
  )
  console.log(
    '浏览器验收通过：项目、Android/iOS/HarmonyOS、商店绑定、版本冲突、安装包上传与真实检查、错配和损坏包、页面账号向导、核对/编辑/重新录入/删除与关联保护、绑定自动回填、只读预检失败反馈、发布自动准备/刷新恢复/一次确认/取消、审核状态独立菜单/发布详情定位跳转/筛选与前后退/荣耀与魅族显式查询/魅族新锚点与旧记录边界/版本观察持久化/刷新零查询/错误恢复、Apple 构建上传确认/已有构建送审/批准后手动发布/处理状态/刷新去重、华为执行回执、小米账号/包名绑定/自动复用资料/立即或定时上架/一次审核提交、OPPO账号/包名绑定/资料自动复用/一次确认/异步处理回执、vivo账号/包名绑定/定时上架/一次确认/明确接收回执、魅族与荣耀账号/数字ID绑定/定时边界/一次送审确认与刷新去重、应用宝与鸿蒙账号/独立平台/正式APP检查/定时摘要/一次送审确认/刷新去重、六渠道紧凑表格/手机卡片/长包名/编辑焦点、问题中心搜索/分类/分页/关联详情/刷新和错误恢复、诊断详情、人工核对与失败保稿、Android 批次分配/失败修正/准备中刷新/关闭零授权/键盘一次确认/停止先于许可/剩余项新摘要/独立结果与刷新去重、持久化、全页面窄屏和无运行时异常。',
  )
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0]
  if (page)
    await page
      .screenshot({ path: 'artifacts/smoke-failure.png', fullPage: true })
      .catch(() => undefined)
  throw error
} finally {
  await browser?.close()
  if (child.exitCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve))
    child.kill('SIGTERM')
    await exited
  }
  await rm(data, { recursive: true, force: true })
}
