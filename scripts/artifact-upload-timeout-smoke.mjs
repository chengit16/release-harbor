/** @description 隔离 Chrome 慢速上传回归；用真实 HTTP 分段发送合成 IPA，不访问用户数据或商店。 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from '@playwright/test'
import { syntheticIpa } from '../tests/fixtures/ipa.ts'

const data = await mkdtemp(join(tmpdir(), 'release-harbor-ui-upload-'))
const port = '4418'
const origin = `http://127.0.0.1:${port}`
const child = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/workbench-server.ts'], {
  env: { ...process.env, RELEASE_HARBOR_DATA_DIR: data, RELEASE_HARBOR_PORT: port },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
child.stdout.on('data', (chunk) => (output += chunk))
child.stderr.on('data', (chunk) => (output += chunk))
let browser
let outgoing
try {
  // 1. 独立端口、临时目录和合成应用，不向用户正在使用的工作台写入测试记录。
  let ready = false
  for (let n = 0; n < 100; n++) {
    if (child.exitCode !== null) throw new Error(output)
    ready = await fetch(origin + '/api/health')
      .then((r) => r.ok)
      .catch(() => false)
    if (ready) break
    await delay(100)
  }
  assert.ok(ready, output)
  const create = async (path, body, key) => {
    const response = await fetch(origin + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    assert.equal(response.status, 201, await response.clone().text())
    return (await response.json())[key]
  }
  const project = await create(
    '/api/projects',
    {
      name: '慢速上传回归',
      key: 'slow-upload',
      framework: 'native',
    },
    'project',
  )
  const app = await create(
    `/api/projects/${project.id}/applications`,
    {
      name: '慢速合成 iOS',
      platform: 'ios',
      identifier: 'com.example.ios',
    },
    'application',
  )
  const endpoint = `/api/projects/${project.id}/applications/${app.id}/artifacts`
  const bytes = syntheticIpa('com.example.ios', true)
  browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: 30000 })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  let started = 0
  let httpStatus = 0
  let forwardingError
  // 2. 只在测试拦截本次文件请求，将同一字节流按45秒间隔转发给真实接收接口。
  // 浏览器仍执行真实上传 Service 与取消时限，后端仍执行真实接收、摘要和独立身份检查。
  await page.route(origin + endpoint, async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    try {
      const actual = route.request().postDataBuffer()
      assert.deepEqual(actual, bytes)
      started = Date.now()
      const response = new Promise((resolve, reject) => {
        outgoing = request(
          origin + endpoint,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/octet-stream',
              'content-length': String(bytes.length),
              'x-artifact-name': encodeURIComponent('慢速合成.ipa'),
              'x-artifact-size': String(bytes.length),
              origin,
            },
          },
          (incoming) => {
            const chunks = []
            incoming.on('data', (chunk) => chunks.push(chunk))
            incoming.on('end', () =>
              resolve({ status: incoming.statusCode, body: Buffer.concat(chunks) }),
            )
            incoming.on('error', reject)
          },
        )
        outgoing.on('error', reject)
      })
      void response.catch(() => undefined)
      for (let part = 0; part < 4; part++) {
        if (part) await delay(45000)
        outgoing.write(
          bytes.subarray(
            Math.floor((bytes.length * part) / 4),
            Math.floor((bytes.length * (part + 1)) / 4),
          ),
        )
      }
      outgoing.end()
      const result = await response
      httpStatus = result.status
      await route.fulfill({
        status: result.status,
        contentType: 'application/json',
        body: result.body,
      })
    } catch (error) {
      forwardingError = error
      await route.abort().catch(() => undefined)
    }
  })
  await page.goto(`${origin}/?view=projects&project=${project.id}&application=${app.id}`)
  await page.getByRole('tab', { name: '安装包', exact: true }).click()
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: '慢速合成.ipa', mimeType: 'application/octet-stream', buffer: bytes })
  await page.getByRole('button', { name: '上传并检查', exact: true }).click()
  await page.waitForFunction(() => document.body.innerText.includes('正在上传文件并登记'))
  for (let n = 0; n < 1000 && !started; n++) await delay(10)
  assert.ifError(forwardingError)
  assert.ok(started, '浏览器应及时发起待验证的上传请求')
  while (Date.now() - started < 126000)
    await delay(Math.min(45000, 126000 - (Date.now() - started)))
  assert.equal(
    await page.getByRole('button', { name: '停止本地等待', exact: true }).count(),
    1,
    '超过旧125秒客户端期限仍应等待正在持续接收的请求',
  )
  const receiving = (await (await fetch(origin + endpoint)).json()).items[0]
  assert.equal(receiving.status, 'receiving', '超过旧120秒服务端期限仍应接收')
  console.log('126秒检查通过：浏览器仍等待，后端仍接收')
  // 3. 完成后检查真实摘要、身份及刷新恢复，不能仅以浏览器没有报错作为成功。
  await page.getByText('身份检查通过', { exact: true }).waitFor({ timeout: 40000 })
  assert.ifError(forwardingError)
  assert.equal(httpStatus, 202)
  const record = (await (await fetch(origin + endpoint)).json()).items[0]
  assert.equal(record.status, 'ready')
  assert.equal(record.sha256, createHash('sha256').update(bytes).digest('hex'))
  assert.equal(record.identity.packageName, 'com.example.ios')
  await page.reload()
  await page.getByText('身份检查通过', { exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log(
    `慢速上传Chrome回归通过：真实HTTP持续${Date.now() - started}ms、202、摘要与身份检查及刷新恢复`,
  )
} finally {
  outgoing?.destroy()
  await browser?.close()
  if (child.exitCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve))
    child.kill('SIGTERM')
    await exited
  }
  await rm(data, { recursive: true, force: true })
}
