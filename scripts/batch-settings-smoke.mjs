/** @description 批次默认说明与日期回填的隔离 Chrome 回归；仅使用合成应用，不准备或执行发布。 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'
import { syntheticApk } from '../tests/fixtures/apk.ts'
import { captureScreenshot } from './capture-screenshot.mjs'

/** 验证默认展开、版本说明与定时逐行回填；不持有真实账号，不发起商店请求。
 * 长函数保留原因：初始化、批量应用和逐行编辑共享同一个隔离浏览器场景，连续验证用户操作链。 */
export async function runBatchSettingsSmoke(page, origin, dataRoot) {
  // 1. 使用独立合成应用与实际解析的 APK，避免依赖前序冒烟的页面状态。
  const create = async (path, input) => {
    const response = await fetch(origin + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
    assert.equal(response.status, 201, await response.clone().text())
    return response
  }
  const projectResponse = await fetch(origin + '/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: '批次设置回归',
      key: 'batch-settings',
      framework: 'react-native',
      description: '隔离浏览器回归',
    }),
  })
  assert.equal(projectResponse.status, 201, await projectResponse.clone().text())
  const project = (await projectResponse.json()).project
  const appResponse = await fetch(`${origin}/api/projects/${project.id}/applications`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: '批次日期回填',
      platform: 'android',
      identifier: 'com.example.batchsettings',
    }),
  })
  assert.equal(appResponse.status, 201)
  const app = (await appResponse.json()).application
  const base = `/api/projects/${project.id}/applications/${app.id}`
  for (const channel of ['huawei', 'honor']) {
    await create(base + '/bindings', {
      channel,
      appId: '88880001',
      credentialReference: 'synthetic-batch-settings-' + channel,
    })
  }
  const apk = await syntheticApk(dataRoot, 'com.example.batchsettings')
  assert.ok(apk, '需要本机 Android SDK 生成合成 APK')
  const uploaded = await fetch(origin + base + '/artifacts', {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      'x-artifact-name': 'batch-settings.apk',
      'x-artifact-size': String(apk.length),
    },
    body: apk,
  })
  assert.equal(uploaded.status, 202)
  let artifact
  for (let n = 0; n < 100; n++) {
    artifact = (await (await fetch(origin + base + '/artifacts')).json()).items[0]
    if (artifact?.status === 'ready') break
    await delay(100)
  }
  assert.equal(artifact?.status, 'ready')
  let writes = 0
  const countWrites = (request) => {
    if (
      request.method() !== 'GET' &&
      /release-preparations|confirm|\/execute|release-batches/.test(request.url())
    )
      writes++
  }
  page.on('request', countWrites)
  await page.goto(
    `${origin}/?view=releases&project=${project.id}&application=${app.id}&releaseView=batch&releaseTask=workspace`,
  )
  const panel = page.getByRole('region', { name: '多渠道发布批次', exact: true })
  await panel.getByRole('checkbox', { name: '选择全部', exact: true }).check()
  const common = panel.getByRole('button', { name: /批量设置/ })
  const wasExpanded = await common.getAttribute('aria-expanded')
  if (wasExpanded !== 'true') await common.click()
  const notes = panel.getByRole('textbox', { name: '批次通用更新说明', exact: true })
  const select = panel.getByRole('combobox', { name: '批次通用安装包', exact: true })
  await select.click()
  await select.press('ArrowDown')
  await select.press('Enter')
  const defaultNotes = await notes.inputValue()
  await captureScreenshot(page, 'artifacts/batch-default-notes-desktop.png')
  const clearPackage = async () => {
    await panel.locator('.ant-select-clear').first().click()
  }
  // 默认文案随包变化，用户手写或主动清空后不再被选择安装包覆盖。
  await clearPackage()
  assert.equal(await notes.inputValue(), '旨在提升软件稳定性')
  await select.click()
  await select.press('ArrowDown')
  await select.press('Enter')
  assert.equal(await notes.inputValue(), defaultNotes)
  await notes.fill('定时回填回归说明')
  await clearPackage()
  await select.click()
  await select.press('ArrowDown')
  await select.press('Enter')
  assert.equal(await notes.inputValue(), '定时回填回归说明')
  await notes.fill('')
  await clearPackage()
  await select.click()
  await select.press('ArrowDown')
  await select.press('Enter')
  assert.equal(await notes.inputValue(), '', '主动清空的说明不能被自动文案覆盖')
  await notes.fill('定时回填回归说明')
  // 2. 同一时刻先应用到两行，再打开渠道编辑；回填必须与公共表单完全一致。
  await panel.getByRole('radio', { name: '指定时间上架', exact: true }).check()
  const stamp = '2099-05-06 15:04:03'
  const date = panel.getByRole('textbox', { name: '指定上架时间', exact: true })
  await date.fill(stamp)
  await date.press('Enter')
  await panel.getByRole('button', { name: '应用到 2 个已选渠道', exact: true }).click()
  await panel.getByRole('button', { name: '编辑荣耀发布内容', exact: true }).click()
  const editor = page.getByRole('dialog', { name: '编辑荣耀发布内容', exact: true })
  const actual = await editor
    .getByRole('textbox', { name: '指定上架时间', exact: true })
    .inputValue()
  console.log(
    JSON.stringify({ wasExpanded, defaultNotes, expectedDate: stamp, actualDate: actual }),
  )
  assert.equal(actual, stamp, '应用批量定时后，渠道编辑必须回填同一日期与秒数')
  assert.equal(wasExpanded, 'true', '批量设置首次进入应默认展开')
  assert.equal(defaultNotes, `“${artifact.identity.versionName}”更新说明\n旨在提升软件稳定性`)
  await editor.getByLabel('本渠道更新说明').fill('修改说明仍保留已选时间')
  await editor.getByRole('button', { name: /确\s*定/, exact: true }).click()
  await panel.getByRole('button', { name: '编辑荣耀发布内容', exact: true }).click()
  assert.equal(await editor.getByLabel('本渠道更新说明').inputValue(), '修改说明仍保留已选时间')
  assert.equal(
    await editor.getByRole('textbox', { name: '指定上架时间', exact: true }).inputValue(),
    stamp,
  )
  await captureScreenshot(page, 'artifacts/batch-channel-date-desktop.png')
  await editor.getByRole('button', { name: /取\s*消/, exact: true }).click()
  await panel.getByRole('button', { name: '编辑华为 AppGallery发布内容', exact: true }).click()
  const huaweiEditor = page.getByRole('dialog', {
    name: '编辑华为 AppGallery发布内容',
    exact: true,
  })
  assert.equal(
    await huaweiEditor.getByRole('textbox', { name: '指定上架时间', exact: true }).inputValue(),
    stamp,
  )
  await huaweiEditor.getByRole('radio', { name: '审核通过后立即上架', exact: true }).check()
  await huaweiEditor.getByRole('button', { name: /确\s*定/, exact: true }).click()
  await panel.getByRole('button', { name: '编辑华为 AppGallery发布内容', exact: true }).click()
  await huaweiEditor.getByRole('radio', { name: '指定时间上架', exact: true }).check()
  assert.equal(
    await huaweiEditor.getByRole('textbox', { name: '指定上架时间', exact: true }).inputValue(),
    '',
    '立即上架不能泄漏其他行或旧编辑的时间',
  )
  await huaweiEditor.getByRole('button', { name: /取\s*消/, exact: true }).click()
  // 3. 桌面与手机均检查可见内容与溢出；编辑过程不能隐式发起发布。
  for (const width of [1440, 375, 844]) {
    await page.setViewportSize({ width, height: 1000 })
    if ((await common.getAttribute('aria-expanded')) !== 'true') await common.click()
    await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth)
    await captureScreenshot(page, `artifacts/batch-settings-${width}.png`)
    await panel.getByRole('button', { name: '编辑荣耀发布内容', exact: true }).click()
    assert.equal(
      await editor.getByRole('textbox', { name: '指定上架时间', exact: true }).inputValue(),
      stamp,
    )
    await captureScreenshot(page, `artifacts/batch-channel-date-${width}.png`)
    await editor.getByRole('button', { name: /取\s*消/, exact: true }).click()
  }
  assert.equal(writes, 0, '批次设置与编辑不得发起准备、确认或执行')
  page.off('request', countWrites)
  await page.setViewportSize({ width: 1440, height: 1000 })
}

// 独立执行时创建回环夹具并始终清理，不读取用户业务目录。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const data = await mkdtemp(join(tmpdir(), 'release-harbor-ui-batch-settings-'))
  const port = '4417',
    origin = `http://127.0.0.1:${port}`
  const child = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/workbench-server.ts'], {
    env: {
      ...process.env,
      RELEASE_HARBOR_DATA_DIR: data,
      RELEASE_HARBOR_PORT: port,
      RELEASE_HARBOR_MODE: 'local',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = '',
    browser
  child.stdout.on('data', (chunk) => {
    output += chunk
  })
  child.stderr.on('data', (chunk) => {
    output += chunk
  })
  try {
    let ready = false
    for (let n = 0; n < 100; n++) {
      if (child.exitCode !== null) throw new Error(output)
      try {
        ready = (await fetch(origin + '/api/health')).ok
      } catch {}
      if (ready) break
      await delay(100)
    }
    assert.ok(ready, output)
    await mkdir('artifacts', { recursive: true })
    browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: 30000 })
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      timezoneId: 'Asia/Shanghai',
    })
    page.setDefaultTimeout(10000)
    page.on('dialog', (dialog) => void dialog.dismiss())
    await runBatchSettingsSmoke(page, origin, data)
    console.log('批次设置专项 Chrome 回归通过。')
  } finally {
    await browser?.close()
    child.kill('SIGTERM')
    await new Promise((resolve) =>
      child.exitCode !== null ? resolve() : child.once('exit', resolve),
    )
    await rm(data, { recursive: true, force: true })
  }
}
