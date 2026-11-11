/** @description 本机团队隔离验证；使用合成账号、独立数据根及可选的真实 Chrome。 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'
import { chromium } from '@playwright/test'
import { createApp } from '../apps/api/src/app.ts'
import { LocalTeamStore } from '../apps/api/src/local-team/store.ts'
import { FileProjectStore } from '../apps/api/src/project-store.ts'

const adminSecret = ['synthetic', 'admin', 'passphrase'].join('-')
const memberSecret = 'synthetic-member-passphrase'
const replacement = 'synthetic-member-replacement'

test('本机启用后关闭免登录入口，成员会话与账号代次一致', async (t) => {
  const root = await isolated(t)
  const team = new LocalTeamStore(root)
  const project = new FileProjectStore(join(root, 'projects.json'))
  const app = await createApp(project, { team })
  t.after(() => app.close())
  const server = app.getHttpAdapter().getInstance()
  const host = '127.0.0.1:4399'
  const origin = 'http://' + host
  const get = (url: string, cookie?: string) =>
    server.inject({
      method: 'GET',
      url: '/api/' + url,
      headers: { host, ...(cookie ? { cookie } : {}) },
    })
  const post = (url: string, payload: object, cookie?: string, from = origin) =>
    server.inject({
      method: 'POST',
      url: '/api/' + url,
      headers: { host, origin: from, ...(cookie ? { cookie } : {}), 'x-release-harbor-team': '1' },
      payload,
    })
  async function signIn(username: string, password: string): Promise<string> {
    const response = await post('team/login', { username, password })
    assert.equal(response.statusCode, 200, response.body)
    assert.match(String(response.headers['set-cookie']), /HttpOnly; SameSite=Strict/)
    assert.deepEqual(response.json(), { ok: true })
    return String(response.headers['set-cookie']).split(';')[0] ?? ''
  }

  // 1. 原数据由新版宿主接管，初始化不会迁移、覆盖或开放业务路由。
  assert.deepEqual((await get('team/session')).json(), { mode: 'personal' })
  assert.equal(
    (await post('projects', { name: '原有项目', key: 'existing', framework: 'native' })).statusCode,
    201,
  )
  await team.initialize('admin', adminSecret)
  await assert.rejects(team.initialize('duplicate', adminSecret), /已经启用/)
  assert.equal((await get('projects')).statusCode, 401)
  assert.equal(
    (await post('projects', { name: '匿名项目', key: 'anonymous', framework: 'native' }))
      .statusCode,
    401,
  )
  assert.equal(
    (
      await post(
        'team/login',
        { username: 'admin', password: adminSecret },
        undefined,
        'http://localhost:5178',
      )
    ).statusCode,
    403,
  )
  assert.deepEqual((await get('team/session')).json(), { mode: 'signed_out' })
  assert.equal(
    (await post('team/login', { username: 'admin', password: replacement })).statusCode,
    401,
  )
  const admin = await signIn('admin', adminSecret)
  assert.equal((await get('projects', admin)).json().items[0].name, '原有项目')

  // 2. 仅管理员能维护成员；成员不能借 API 或伪造管理员字段获取业务权限。
  assert.equal(
    (
      await post(
        'team/members',
        { username: 'tester', password: memberSecret, role: 'admin' },
        admin,
      )
    ).statusCode,
    400,
  )
  const created = await post('team/members', { username: 'tester', password: memberSecret }, admin)
  assert.equal(created.statusCode, 201, created.body)
  const item = created.json()
  assert.deepEqual(Object.keys(item).sort(), ['enabled', 'id', 'role', 'username'])
  const member = await signIn('tester', memberSecret)
  assert.equal((await get('team/session', member)).json().member.role, 'member')
  for (const path of [
    'projects',
    'team/members',
    'local',
    'store-status',
    'release-center',
    'credential-accounts',
  ])
    assert.equal((await get(path, member)).statusCode, 403, path)
  const target = 'team/members/' + item.id

  // 3. 停用、重开、改密、退出都不复活旧会话；独立标记使重启后仍然拒绝缺失目录。
  assert.equal((await post(target, { action: 'disable' }, admin)).statusCode, 200)
  assert.deepEqual((await get('team/session', member)).json(), { mode: 'signed_out' })
  assert.equal(
    (await post('team/login', { username: 'tester', password: memberSecret })).statusCode,
    401,
  )
  assert.equal((await post(target, { action: 'enable' }, admin)).statusCode, 200)
  assert.equal((await get('projects', member)).statusCode, 401)
  const beforeReset = await signIn('tester', memberSecret)
  assert.equal(
    (await post(target, { action: 'reset', password: replacement }, admin)).statusCode,
    200,
  )
  assert.deepEqual((await get('team/session', beforeReset)).json(), { mode: 'signed_out' })
  const afterReset = await signIn('tester', replacement)
  assert.equal((await post('team/logout', {}, afterReset)).statusCode, 200)
  assert.deepEqual((await get('team/session', afterReset)).json(), { mode: 'signed_out' })
  const path = join(root, '.local', 'team.json')
  const saved = await readFile(path, 'utf8')
  for (const value of [adminSecret, memberSecret, replacement, admin, member])
    assert.ok(!saved.includes(value))
  await rename(path, path + '.missing')
  await assert.rejects(new LocalTeamStore(root).read(), /工作台已锁定/)
  assert.equal((await get('projects', admin)).statusCode, 503)
})

test(
  'Chrome 原工作台：管理员登录、创建成员及无授权成员无业务请求',
  { skip: process.env.RELEASE_HARBOR_TEAM_TEST_BROWSER !== '1', timeout: 45000 },
  async (t) => {
    const root = await isolated(t)
    const team = new LocalTeamStore(root)
    await team.initialize('admin', adminSecret)
    const port = await availablePort()
    const app = await createApp(new FileProjectStore(join(root, 'projects.json')), {
      team,
      port,
      webRoot: resolve(process.env.RELEASE_HARBOR_TEAM_TEST_WEB_ROOT || 'apps/web/dist'),
    })
    t.after(() => app.close())
    await app.listen(port, '127.0.0.1')
    const browser = await chromium.launch({ channel: 'chrome' })
    t.after(() => browser.close())
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    page.setDefaultTimeout(10000)
    const business: string[] = []
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname
      if (path.startsWith('/api/') && !path.startsWith('/api/team/')) business.push(path)
    })
    await page.goto('http://127.0.0.1:' + port + '/?view=roadmap')
    await page.getByRole('heading', { name: '本机团队工作台' }).waitFor()
    assert.deepEqual(business, [])
    await page.getByLabel('登录名', { exact: true }).fill('admin')
    await page.getByLabel('密码', { exact: true }).fill(adminSecret)
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await page.getByText('当前优先：本机团队工作台').waitFor()
    await page.getByRole('menuitem', { name: '成员管理', exact: true }).click()
    await page.getByRole('button', { name: '添加成员', exact: true }).click()
    await page.getByLabel('成员登录名').fill('tester')
    await page.getByLabel('初始密码').fill(memberSecret)
    await page.getByRole('button', { name: '创建成员' }).click()
    await page.getByText('tester', { exact: true }).waitFor()
    await mkdir('artifacts', { recursive: true })
    await page.screenshot({ path: 'artifacts/local-team-admin.png' })
    await page.keyboard.press('Escape')
    await page.setViewportSize({ width: 375, height: 812 })
    const memberButton = page.getByRole('button', { name: '添加成员', exact: true })
    await memberButton.waitFor()
    const position = await memberButton.boundingBox()
    assert.ok(position && position.x >= 0 && position.x + position.width <= 375)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.getByRole('button', { name: '退出登录' }).click()
    await page.getByRole('heading', { name: '本机团队工作台' }).waitFor()
    business.length = 0
    await page.screenshot({ path: 'artifacts/local-team-login-mobile.png' })
    await page.getByLabel('登录名', { exact: true }).fill('tester')
    await page.getByLabel('密码', { exact: true }).fill(memberSecret)
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await page.getByText('已登录：tester').waitFor()
    assert.deepEqual(business, [])
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    assert.deepEqual(pageErrors, [])
    await page.close()
  },
)

async function isolated(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'harbor-local-team-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

async function availablePort(): Promise<number> {
  const socket = createServer()
  await new Promise<void>((done, reject) =>
    socket.listen(0, '127.0.0.1', done).once('error', reject),
  )
  const address = socket.address()
  await new Promise<void>((done, reject) =>
    socket.close((error) => (error ? reject(error) : done())),
  )
  assert.ok(address && typeof address === 'object')
  return address.port
}
