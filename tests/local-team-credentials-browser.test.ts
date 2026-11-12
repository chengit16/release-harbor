/** @description 用真实浏览器保护本机团队的凭据更新流程，合成材料仅进入内存安全库夹具。 */
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from '@playwright/test'
import { createApp } from '../apps/api/src/app.ts'
import { FileApplicationStore } from '../apps/api/src/application-store.ts'
import { CredentialAccountsService } from '../apps/api/src/credential-accounts.service.ts'
import { LocalTeamStore } from '../apps/api/src/local-team/store.ts'
import { FileProjectStore } from '../apps/api/src/project-store.ts'
import { TestCredentialIntake } from './fixtures/credential-intake.ts'

async function availablePort(): Promise<number> {
  const socket = createServer().listen(0, '127.0.0.1')
  await once(socket, 'listening')
  const address = socket.address()
  assert.ok(address && typeof address === 'object')
  await new Promise<void>((resolve, reject) =>
    socket.close((error) => (error ? reject(error) : resolve())),
  )
  return address.port
}

test(
  'Chrome 本机团队管理员更新 OPPO：会话创建需登录，材料直传不携带团队 Cookie',
  { skip: process.env.RELEASE_HARBOR_TEAM_TEST_BROWSER !== '1', timeout: 45000 },
  async (t) => {
    // 1. 在隔离数据根建立团队及原凭据，更新必须沿用原引用。
    const root = await mkdtemp(join(tmpdir(), 'harbor-team-credential-browser-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const port = await availablePort()
    const origin = `http://127.0.0.1:${port}`
    const team = new LocalTeamStore(root)
    const password = ['synthetic', 'admin', 'passphrase'].join('-')
    await team.initialize('admin', password)
    const projectStore = new FileProjectStore(join(root, 'projects.json'))
    const applicationStore = new FileApplicationStore(join(root, 'applications.json'))
    const intake = new TestCredentialIntake(root, [origin])
    const app = await createApp(projectStore, {
      applicationStore,
      credentialAccounts: new CredentialAccountsService(
        intake,
        [origin],
        projectStore,
        applicationStore,
      ),
      team,
      port,
      webRoot: resolve(process.env.RELEASE_HARBOR_TEAM_TEST_WEB_ROOT || 'apps/web/dist'),
    })
    t.after(() => app.close())
    await app.listen(port, '127.0.0.1')
    const original = await intake.session('oppo', origin)
    await intake.engine.save(original.id, {
      displayName: '合成 OPPO',
      credentials: { clientId: 'o'.repeat(19), clientSecret: 'o'.repeat(64) },
    })
    for (let i = 0; i < 100; i++) {
      if ((await intake.operation(original.operationId))?.status === 'saved') break
      await delay(25)
    }
    assert.equal((await intake.operation(original.operationId))?.status, 'saved')
    const before = (await intake.accounts()).accounts.find(
      (item) => item.reference === original.reference,
    )
    assert.ok(before)

    // 2. 通过登录页和账号维护进入向导，捕捉实际请求验证登录与材料分别传输。
    const browser = await chromium.launch({ channel: 'chrome' })
    t.after(() => browser.close())
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    page.setDefaultTimeout(6000)
    await page.goto(origin)
    await page.getByLabel('登录名', { exact: true }).fill('admin')
    await page.getByLabel('密码', { exact: true }).fill(password)
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await page.getByRole('menuitem', { name: '商店账号', exact: true }).click()
    await page.getByRole('button', { name: '管理账号 合成 OPPO', exact: true }).click()
    await page.getByRole('button', { name: '更新凭据', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '更新凭据', exact: true })
    const opened = page.waitForResponse((response) =>
      response.url().endsWith('/api/local-credential-sessions'),
    )
    await dialog.getByRole('button', { name: '下一步', exact: true }).click()
    const session = await opened
    assert.equal(session.status(), 201, '已登录的管理员应能创建本机配置会话')
    assert.ok((await session.request().allHeaders()).cookie?.includes('rh_team_'))
    const start = session.request().postDataJSON() as Record<string, unknown>
    assert.deepEqual(Object.keys(start).sort(), ['channel', 'replacement'])

    // 3. 确认材料只发往独立回环端口，随后核对原引用及新版本。
    await dialog.getByLabel('Client ID', { exact: true }).fill('n'.repeat(19))
    await dialog.getByLabel('Client Secret', { exact: true }).fill('n'.repeat(64))
    await dialog.getByRole('button', { name: '下一步', exact: true }).click()
    const submitted = page.waitForResponse(
      (response) => response.url().endsWith('/profile') && response.request().method() === 'POST',
    )
    await dialog.getByRole('button', { name: '保存账号', exact: true }).click()
    const saved = await submitted
    assert.equal(saved.status(), 202)
    assert.equal(new URL(saved.url()).origin, intake.server.endpoint)
    assert.equal((await saved.request().allHeaders()).cookie, undefined)
    await dialog.waitFor({ state: 'hidden' })
    const after = (await intake.accounts()).accounts.find(
      (item) => item.reference === original.reference,
    )
    assert.ok(after?.configured)
    assert.notEqual(after.managementRevision, before.managementRevision)

    // 4. 会话确实失效时，向导仍停在材料录入之前并提示重新登录。
    await page.getByRole('button', { name: '更新凭据', exact: true }).click()
    await page.context().clearCookies()
    await dialog.getByRole('button', { name: '下一步', exact: true }).click()
    await dialog.getByRole('alert').filter({ hasText: '登录已失效' }).waitFor()
    assert.equal(await dialog.getByLabel('Client Secret', { exact: true }).isVisible(), false)
  },
)
