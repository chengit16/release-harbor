/** @description 本机日常优化 Chrome 验收；隔离产物与账号，无准备、授权或商店写入。 */
import { openWorkbenchPage, readNavigationUrl } from './navigation-state.mjs'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { syntheticApk } from '../tests/fixtures/apk.ts'
import { captureScreenshot } from './capture-screenshot.mjs'

/** 验证模板保稿与清空安装包、下载／回收、历史保留与三种视口。 */
export async function runLocalProductivitySmoke(page, origin, dataRoot) {
  const previousUrl = (await readNavigationUrl(page)).href
  const projects = await (await fetch(origin + '/api/projects')).json(),
    project = projects.items[0].id
  const created = await fetch(`${origin}/api/projects/${project}/applications`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: '日常维护合成应用',
      platform: 'android',
      identifier: 'com.example.productivity',
    }),
  })
  assert.equal(created.status, 201)
  const application = (await created.json()).application,
    base = `${origin}/api/projects/${project}/applications/${application.id}`
  const bound = await fetch(base + '/bindings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      channel: 'huawei',
      appId: '88881001',
      credentialReference: 'synthetic-productivity-profile',
    }),
  })
  assert.equal(bound.status, 201)
  const apk = await syntheticApk(dataRoot, 'com.example.productivity')
  assert.ok(apk)
  const upload = await fetch(base + '/artifacts', {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      'x-artifact-name': 'productivity-synthetic.apk',
      'x-artifact-size': String(apk.length),
    },
    body: apk,
  })
  assert.equal(upload.status, 202)
  let artifact
  for (let n = 0; n < 100; n++) {
    artifact = (await (await fetch(base + '/artifacts')).json()).items[0]
    if (artifact?.status === 'ready') break
    await delay(100)
  }
  assert.equal(artifact.status, 'ready')
  let writes = 0
  const listener = (r) => {
    if (
      r.method() !== 'GET' &&
      /release-preparations|confirm|\/execute|release-batches/.test(r.url())
    )
      writes++
  }
  page.on('request', listener)
  const url =
    origin +
    `/?view=releases&project=${project}&application=${application.id}&releaseTask=workspace`
  await page.setViewportSize({ width: 1440, height: 1000 })
  await openWorkbenchPage(page, url)
  const form = page.getByRole('region', { name: '发布计划', exact: true })
  const choose = async (label) => {
    const select = form.getByRole('combobox', { name: label, exact: true })
    await select.click()
    await select.press('ArrowDown')
    await select.press('Enter')
  }
  await choose('发布渠道')
  await choose('发布安装包')
  await form.getByRole('textbox', { name: '更新说明', exact: true }).fill('优化日常发布体验')
  await form.getByRole('button', { name: '复用配置与常用模板', exact: true }).click()
  await form.getByRole('textbox', { name: '发布模板名称', exact: true }).fill('常规更新验收模板')
  await form.getByRole('button', { name: '保存当前配置为模板', exact: true }).click()
  await form.getByText('模板已保存，未准备或执行发布', { exact: true }).waitFor()
  await form.getByRole('textbox', { name: '更新说明', exact: true }).fill('未保存草稿必须保留')
  await choose('选择复用配置')
  await form.getByRole('button', { name: '带入所选配置', exact: true }).click()
  const modal = page.getByRole('dialog', { name: '确认带入发布配置', exact: true })
  await modal.getByRole('button', { name: /取\s*消/, exact: true }).click()
  assert.equal(
    await form.getByRole('textbox', { name: '更新说明', exact: true }).inputValue(),
    '未保存草稿必须保留',
  )
  await form.getByRole('button', { name: '带入所选配置', exact: true }).click()
  await modal.getByRole('button', { name: '确认带入', exact: true }).click()
  assert.equal(
    await form.getByRole('textbox', { name: '更新说明', exact: true }).inputValue(),
    '优化日常发布体验',
  )
  assert.equal(await form.locator('#artifactId').inputValue(), '')
  const presets = await (
    await fetch(`${origin}/api/local/reuse/${project}/${application.id}`)
  ).json()
  assert.equal(presets.items.filter((i) => i.source === 'template').length, 1)
  await page.reload()
  await form.getByRole('button', { name: '复用配置与常用模板', exact: true }).click()
  await choose('选择复用配置')
  await captureScreenshot(page, 'artifacts/productivity-reuse-desktop.png')
  // 批次模板入口独立，当前没有安装包也可保存选择和说明；应用不会准备。
  await openWorkbenchPage(page, url + '&releaseView=batch')
  const batch = page.getByRole('region', { name: '多渠道发布批次', exact: true })
  await batch.getByRole('checkbox', { name: '选择全部', exact: true }).check()
  await batch
    .getByRole('textbox', { name: '批次通用更新说明', exact: true })
    .fill('批次常规说明验收')
  await batch.getByRole('button', { name: '应用到 1 个已选渠道', exact: true }).click()
  await batch.getByRole('button', { name: '复用配置与常用模板', exact: true }).click()
  await batch.getByRole('textbox', { name: '发布模板名称', exact: true }).fill('批次模板验收')
  await batch.getByRole('button', { name: '保存当前配置为模板', exact: true }).click()
  await batch.getByText('模板已保存，未准备或执行发布', { exact: true }).waitFor()
  await openWorkbenchPage(page, origin + '/?view=settings&localTab=storage')
  const storage = page.getByRole('region', { name: '安装包存储管理', exact: true })
  await storage
    .getByRole('textbox', { name: '搜索安装包', exact: true })
    .fill('productivity-synthetic')
  await storage.getByText('productivity-synthetic.apk', { exact: true }).waitFor()
  const downloaded = page.waitForEvent('download')
  await storage.getByRole('link', { name: '下载安装包', exact: true }).click()
  const download = await downloaded
  assert.equal(download.suggestedFilename(), 'productivity-synthetic.apk')
  for (const width of [1440, 375, 844]) {
    await page.setViewportSize({ width, height: 1000 })
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `存储管理 ${width} 无溢出`,
    )
    const geometry = await page.evaluate(() => ({
      heading: document.querySelector('.page-heading h1')?.getBoundingClientRect().left,
      crumb: document.querySelector('.topbar .ant-breadcrumb')?.getBoundingClientRect().left,
    }))
    assert.ok(Math.abs(geometry.heading - geometry.crumb) <= 2, JSON.stringify(geometry))
    await captureScreenshot(page, `artifacts/productivity-storage-${width}.png`)
  }
  await storage.getByRole('button', { name: '清理原文件', exact: true }).click()
  const cleanup = page.getByRole('dialog', { name: '确认清理安装包原文件', exact: true })
  await cleanup.getByRole('button', { name: /取\s*消/, exact: true }).click()
  assert.equal((await (await fetch(base + '/artifacts')).json()).items[0].status, 'ready')
  await storage.getByRole('button', { name: '清理原文件', exact: true }).click()
  const cleanupResult = page.waitForResponse(
    (r) => r.url().endsWith('/api/local/artifacts/cleanup') && r.request().method() === 'POST',
  )
  await cleanup.getByRole('button', { name: '确认清理原文件', exact: true }).click()
  const cleanupResponse = await cleanupResult
  assert.ok(cleanupResponse.ok(), await cleanupResponse.text())
  await cleanup.waitFor({ state: 'hidden' })
  await storage.getByText('已清理', { exact: true }).waitFor()
  assert.equal((await (await fetch(base + '/artifacts')).json()).items[0].failureCode, 'removed')
  assert.equal(writes, 0, '复用、下载和清理不能发起发布准备或确认')
  page.off('request', listener)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await openWorkbenchPage(page, previousUrl)
  console.log(
    '本机日常优化 Chrome 验收通过：模板保存／刷新／取消保稿／带入清包、批次模板、实际下载、清理确认和历史保留、三种视口几何与无溢出、零发布请求。',
  )
}
