/** @description 小米页面完整流程的隔离 Chrome 验收；真实本机配置 HTTP、实际合成 APK、固定替身预检与执行，不请求商店。 */
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { syntheticApk } from '../tests/fixtures/apk.ts'
import { captureScreenshot } from './capture-screenshot.mjs'
import { setTimeout as delay } from 'node:timers/promises'

/** 页面录入秘密只能发送独立配置进程；发布摘要和普通 API 不得包含测试登录材料。
 * 长函数保留原因：按实际用户的一次连贯操作验证跨页面状态，测试使用独立目录与依赖替身。
 */
export async function runXiaomiSmoke(page, origin, dataRoot) {
  // 1. 从页面创建并自动选择小米材料，绑定目标无需手填数字 ID。
  const url = new URL(page.url()),
    project = url.searchParams.get('project')
  const base = `${origin}/api/projects/${project}/applications`
  const created = await fetch(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: '小米合成应用',
      platform: 'android',
      identifier: 'com.example.xiaomi',
    }),
  })
  assert.equal(created.status, 201)
  const response = await created.json(),
    application = response.application ?? response
  url.searchParams.set('application', application.id)
  url.searchParams.set('tab', 'bindings')
  await page.goto(url.href)
  await page.getByRole('button', { name: '添加商店绑定', exact: true }).click()
  const channel = page.getByRole('combobox', { name: '绑定商店渠道', exact: true })
  await channel.click()
  await channel.press('ArrowDown')
  await channel.press('Enter')
  await page.getByLabel('小米目标包名', { exact: true }).waitFor()
  assert.equal(
    await page.getByLabel('小米目标包名', { exact: true }).inputValue(),
    'com.example.xiaomi',
  )
  assert.ok(
    (await page.getByLabel('小米目标包名', { exact: true }).getAttribute('readonly')) !== null,
  )
  await page.getByRole('button', { name: '新增账号', exact: true }).click()
  const wizard = page.getByRole('dialog', { name: '新增商店账号', exact: true })
  await wizard.getByLabel('账号名称', { exact: true }).fill('小米浏览器合成账号')
  await wizard.getByRole('button', { name: '下一步', exact: true }).click()
  const publicKey = generateKeyPairSync('rsa', { modulusLength: 2048 })
    .publicKey.export({ format: 'pem', type: 'spki' })
    .toString()
  const secret = 'synthetic-xiaomi-browser-secret',
    login = 'synthetic-xiaomi-test-password'
  const leaks = []
  const observer = (request) => {
    const body = request.postData() ?? ''
    if (body.includes(secret) || body.includes(login)) {
      const target = new URL(request.url())
      if (
        target.hostname !== '127.0.0.1' ||
        !/^\/v1\/sessions\/[^/]+\/profile$/.test(target.pathname)
      )
        leaks.push(target.pathname)
    }
  }
  page.on('request', observer)
  await wizard.getByLabel('开发者邮箱', { exact: true }).fill('browser@example.com')
  await wizard.getByLabel('API 访问密码', { exact: true }).fill(secret)
  await wizard.getByLabel('RSA 公钥内容', { exact: true }).fill(publicKey)
  const mode = wizard.getByRole('combobox', { name: '审核测试方式', exact: true })
  await mode.click()
  await page
    .locator('.ant-select-dropdown:visible')
    .getByText('测试账号密码登录', { exact: true })
    .click()
  await wizard.getByLabel('审核测试账号', { exact: true }).fill('synthetic-test-user')
  await wizard.getByLabel('审核测试密码', { exact: true }).fill(login)
  await wizard.getByLabel('审核体验说明', { exact: true }).fill('合成测试，不用于商店')
  await page.setViewportSize({ width: 390, height: 844 })
  assert.ok(await wizard.evaluate((e) => e.scrollWidth <= e.clientWidth), '小米账号向导窄屏溢出')
  await captureScreenshot(page, 'artifacts/xiaomi-account-mobile.png')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await wizard.getByRole('button', { name: '下一步', exact: true }).click()
  await wizard.getByRole('button', { name: '保存账号', exact: true }).click()
  await wizard.waitFor({ state: 'hidden', timeout: 20000 })
  await page.getByText('小米浏览器合成账号', { exact: true }).first().waitFor()
  await page.getByRole('button', { name: '保存绑定', exact: true }).click()
  const root = base + '/' + application.id
  // 2. 真实合成 APK 经独立检查，再由页面提交冻结的公开资料。
  const apk = await syntheticApk(dataRoot, 'com.example.xiaomi')
  assert.ok(apk)
  const upload = await fetch(root + '/artifacts', {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      'x-artifact-name': 'xiaomi-synthetic.apk',
      'x-artifact-size': String(apk.length),
    },
    body: apk,
  })
  assert.equal(upload.status, 202)
  for (let n = 0; n < 100; n++) {
    if ((await (await fetch(root + '/artifacts')).json()).items[0]?.status === 'ready') break
    await delay(100)
  }
  await page.getByRole('tab', { name: '发布计划', exact: true }).click()
  const panel = page.getByRole('region', { name: '发布计划', exact: true })
  for (const name of ['发布渠道', '发布安装包']) {
    const field = panel.getByRole('combobox', { name, exact: true })
    await field.click()
    await field.press('ArrowDown')
    await field.press('Enter')
  }
  await panel.getByLabel('更新说明', { exact: true }).fill('小米合成版本更新')
  assert.equal(await panel.getByLabel('小米后台应用名称', { exact: true }).count(), 0)
  assert.equal(await panel.getByLabel('隐私政策地址', { exact: true }).count(), 0)
  assert.equal(await panel.locator('input[type=file]').count(), 0)
  await panel.getByRole('radio', { name: '指定时间上架', exact: true }).check()
  const schedule = panel.getByRole('textbox', { name: '指定上架时间', exact: true })
  const date = new Date(Date.now() + 86400000)
  const stamp =
    [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-') + ' 18:30:00'
  await schedule.fill(stamp)
  await schedule.press('Enter')
  assert.equal(
    (await (await fetch(root + '/release-preparations')).json()).items.length,
    0,
    '确认日期不能自动提交发布表单',
  )
  await captureScreenshot(page, 'artifacts/xiaomi-preparation-desktop.png')
  await page.setViewportSize({ width: 390, height: 844 })
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    '小米准备页窄屏溢出',
  )
  await captureScreenshot(page, 'artifacts/xiaomi-preparation-mobile.png')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await panel.getByRole('button', { name: '准备发布', exact: true }).click()
  // 3. 关闭不授权，一次明确同意才消费；刷新仅查看结果且没有材料泄漏。
  const summary = page.getByRole('dialog', { name: '发布摘要', exact: true })
  await summary.getByRole('button', { name: '确认提交审核', exact: true }).waitFor()
  assert.ok(await summary.getByRole('button', { name: '确认提交审核', exact: true }).isDisabled())
  await summary.getByRole('img', { name: '本次提交的小米图标', exact: true }).waitFor()
  await summary.getByText('小米提交审核', { exact: true }).waitFor()
  await summary.getByText(/自动复用小米公开上架资料/).waitFor()
  await summary.getByText(/指定时间上架：/).waitFor()
  assert.ok(!(await summary.innerText()).includes(login))
  await summary.getByRole('button', { name: '关闭发布摘要', exact: true }).click()
  let plans = (await (await fetch(root + '/release-plans')).json()).items
  assert.equal(plans.length, 1)
  assert.equal(plans[0].plan.snapshot.releasePolicy.mode, 'scheduled')
  assert.ok(Date.parse(plans[0].plan.snapshot.releasePolicy.notBefore) > Date.now())
  assert.equal(plans[0].plan.authorization, null)
  assert.equal((await (await fetch(root + '/release-attempts')).json()).items.length, 0)
  await panel.getByRole('button', { name: '查看发布摘要', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  assert.ok(await summary.evaluate((e) => e.scrollWidth <= e.clientWidth), '小米摘要窄屏溢出')
  await captureScreenshot(page, 'artifacts/xiaomi-summary-mobile.png')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await summary.getByRole('checkbox').check()
  await summary.getByRole('button', { name: '确认提交审核', exact: true }).click()
  await summary.waitFor({ state: 'hidden' })
  const history = page.getByRole('region', { name: '执行记录', exact: true })
  await history.getByText('小米已受理审核提交；不代表审核通过或已上架', { exact: true }).waitFor()
  await page.reload()
  await history.getByText('小米已受理审核提交；不代表审核通过或已上架', { exact: true }).waitFor()
  const attempts = (await (await fetch(root + '/release-attempts')).json()).items
  assert.equal(attempts.length, 1)
  assert.equal(attempts[0].code, 'review_submitted')
  await page
    .getByRole('region', { name: '计划历史', exact: true })
    .getByText('已提交审核', { exact: true })
    .waitFor()
  await page
    .getByRole('region', { name: '执行记录', exact: true })
    .getByText('已提交审核', { exact: true })
    .waitFor()
  assert.equal(await panel.getByText('草稿已保存', { exact: true }).count(), 0)
  assert.deepEqual(leaks, [])
  assert.ok(
    await page.evaluate(
      (secret) =>
        ![...Object.values(localStorage), ...Object.values(sessionStorage), location.href].some(
          (v) => v.includes(secret),
        ),
      login,
    ),
  )
  page.off('request', observer)
}
