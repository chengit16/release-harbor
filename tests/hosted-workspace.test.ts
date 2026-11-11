/** @description 第五期在线目录验收；使用随机 PostgreSQL 数据库、合成 IdP 和独立 Chrome 会话。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chromium, type Page } from '@playwright/test'
import { configuredIssuer, hostedOrigin } from '../apps/api/src/hosted/config.ts'
import { hostedFixture } from './fixtures/hosted-workspace.ts'

test('在线来源固定为 HTTPS；OIDC 发行者保留精确身份而非从请求决定', () => {
  assert.equal(hostedOrigin('https://console.example.test:8443').host, 'console.example.test:8443')
  assert.throws(() => hostedOrigin('http://console.example.test'))
  assert.throws(() => hostedOrigin('https://console.example.test/path'))
  assert.throws(() => hostedOrigin('https://member@console.example.test'))
  assert.equal(configuredIssuer('https://id.example.test/tenant'), 'https://id.example.test/tenant')
  assert.throws(() => configuredIssuer('http://id.example.test/tenant'))
})

const database = process.env.RELEASE_HARBOR_HOSTED_TEST_DATABASE_URL
const withBrowser = process.env.RELEASE_HARBOR_HOSTED_TEST_BROWSER === '1'

test(
  '在线目录验证：OIDC、会话、PostgreSQL 租户约束及实时成员权限',
  { skip: !database },
  async (t) => {
    assert.ok(database)
    const fixture = await hostedFixture(t, database, withBrowser)
    const api = '/api/hosted'
    const first = api + '/workspaces/' + fixture.first
    const second = api + '/workspaces/' + fixture.second
    const input = { name: '合成项目', key: 'shared-project', framework: 'native' }

    function send(
      path: string,
      method = 'GET',
      session?: string,
      body?: object,
      source = fixture.origin,
    ) {
      return fixture.request(path, {
        method,
        headers: {
          ...(method !== 'GET' ? { Origin: source, 'X-Release-Harbor-Hosted': '1' } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(session ? { Cookie: session } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      })
    }

    async function login(identity: string, expected = '/') {
      const start = await send(api + '/auth/start', 'POST', undefined, {})
      assert.equal(start.status, 200)
      const flow = cookie(start, 'login')
      const { url } = await start.json()
      const authorization = new URL(url)
      authorization.searchParams.set('identity', identity)
      const grant = await fetch(authorization, { redirect: 'manual' })
      assert.equal(grant.status, 302)
      const callback = grant.headers.get('location')
      assert.ok(callback)
      const response = await fixture.request(callback, { headers: { Cookie: flow } })
      assert.equal(response.status, 303)
      assert.equal(response.headers.get('location'), expected)
      const replay = await fixture.request(callback, { headers: { Cookie: flow } })
      assert.equal(replay.headers.get('location'), '/?login=invalid')
      return response
    }

    // 1. 真实 OIDC 交换与签名校验；未受邀身份和重复回调不能建立会话。
    await status(send(api + '/session'), 401)
    await status(send(first + '/projects'), 401)
    await status(send('/api/local/backups'), 404)
    await status(send('/api/credential-accounts'), 404)
    const uninvited = await login('uninvited', '/?login=invitation')
    assert.ok(
      !uninvited.headers
        .getSetCookie()
        .some((value) => value.startsWith('__Host-rh-hosted-session=')),
    )
    const admin = cookie(await login('pilot-admin'), 'session')
    const other = cookie(await login('other-admin'), 'session')
    const adminView = await okJson(send(api + '/session', 'GET', admin), 200)
    assert.deepEqual(
      adminView.workspaces.map(({ id }: { id: string }) => id),
      [fixture.first],
    )
    await status(
      send(first + '/projects', 'POST', admin, input, 'https://external.example.test'),
      403,
    )
    await status(
      fixture.request(first + '/projects', {
        method: 'POST',
        headers: { Origin: fixture.origin, Cookie: admin },
      }),
      403,
    )

    // 2. 在两个空间使用相同业务标识；跨空间和错误父级的读写均不能到达资源。
    const project = await okJson(send(first + '/projects', 'POST', admin, input), 201)
    const sibling = await okJson(
      send(first + '/projects', 'POST', admin, { ...input, key: 'other-project' }),
      201,
    )
    const otherProject = await okJson(send(second + '/projects', 'POST', other, input), 201)
    await status(send(second + '/projects', 'GET', admin), 404)
    await status(send(second + '/projects', 'POST', admin, input), 404)
    await status(send(first + '/projects/' + otherProject.id, 'GET', admin), 404)
    await status(
      send(first + '/projects', 'POST', admin, { ...input, workspaceId: fixture.second }),
      400,
    )
    await status(send(first + '/projects', 'POST', admin, input), 409)
    const apps = first + '/projects/' + project.id + '/applications'
    const application = await okJson(
      send(apps, 'POST', admin, {
        name: '合成 Android',
        platform: 'android',
        identifier: 'com.harbor.synthetic',
      }),
      201,
    )
    await status(
      send(first + '/projects/' + sibling.id + '/applications/' + application.id, 'GET', admin),
      404,
    )
    await status(
      send(first + '/projects/' + otherProject.id + '/applications', 'POST', admin, {
        name: '错误空间',
      }),
      404,
    )
    const bindings = apps + '/' + application.id + '/bindings'
    const binding = await okJson(
      send(bindings, 'POST', admin, {
        channel: 'huawei',
        appId: '123456789',
        credentialReference: 'pilot-account',
      }),
      201,
    )
    assert.equal(binding.verification, 'not_checked')
    const change = { appId: '123456790', credentialReference: 'pilot-account', expectedRevision: 1 }
    const updated = await okJson(send(bindings + '/' + binding.id, 'PATCH', admin, change), 200)
    assert.equal(updated.revision, 2)
    await status(send(bindings + '/' + binding.id, 'PATCH', admin, change), 409)
    // 即使应用写入误带了其他空间的父 ID，数据库复合外键仍会拒绝。
    await assert.rejects(
      fixture.pool.query(
        `INSERT INTO rh_hosted.applications (workspace_id, project_id, id, name, platform, identifier)
       VALUES ($1, $2, $3, '跨空间夹具', 'android', 'com.harbor.cross')`,
        [fixture.first, otherProject.id, application.id],
      ),
      { code: '23503' },
    )

    // 3. 成员权限、撤销和退出对仍持有旧 Cookie 的客户端立即生效。
    const member = await okJson(
      send(first + '/members', 'POST', admin, {
        subject: 'pilot-viewer',
        label: '甲查看者',
        role: 'viewer',
      }),
      201,
    )
    assert.deepEqual(Object.keys(member).sort(), ['id', 'label', 'role'])
    const viewer = cookie(await login('pilot-viewer'), 'session')
    await status(send(bindings, 'GET', viewer), 200)
    await status(send(first + '/members', 'GET', viewer), 403)
    await status(send(first + '/projects', 'POST', viewer, input), 403)
    await status(send(first + '/members/' + member.id, 'PATCH', admin, { role: 'admin' }), 200)
    await status(send(first + '/members', 'GET', viewer), 200)
    await status(send(first + '/members/' + member.id, 'PATCH', admin, { role: 'operator' }), 200)
    await status(send(first + '/members', 'GET', viewer), 403)
    const { items } = await okJson(send(first + '/members', 'GET', admin), 200)
    const owner = items.find(({ role }: { role: string }) => role === 'admin')
    assert.ok(owner)
    await status(send(first + '/members/' + owner.id, 'DELETE', admin, {}), 409)
    await status(send(first + '/members/' + member.id, 'DELETE', admin, {}), 200)
    await status(send(first + '/projects', 'GET', viewer), 404)
    assert.deepEqual((await okJson(send(api + '/session', 'GET', viewer), 200)).workspaces, [])
    await status(send(api + '/auth/logout', 'POST', viewer, {}), 200)
    await status(send(api + '/session', 'GET', viewer), 401)

    if (withBrowser) {
      // 双空间用于验证切换会清除旧目录和表单；浏览器重新走独立的 IdP 登录。
      await status(
        send(second + '/members', 'POST', other, {
          subject: 'pilot-admin',
          label: '甲成员',
          role: 'viewer',
        }),
        201,
      )
      await t.test('真实 Chrome：登录、空间切换、成员维护、窄屏及退出', () =>
        smokeBrowser(fixture.origin),
      )
    }
  },
)

function cookie(response: Response, suffix: 'login' | 'session'): string {
  const set = response.headers
    .getSetCookie()
    .find((value) => value.startsWith('__Host-rh-hosted-' + suffix + '='))
  assert.ok(set)
  assert.match(set, /Secure/i)
  assert.match(set, /HttpOnly/i)
  assert.match(set, /SameSite=Lax/i)
  assert.ok(!/Domain=/i.test(set))
  const value = set.split(';')[0]
  assert.ok(value)
  return value
}

async function status(response: Promise<Response>, expected: number) {
  const value = await response
  const body = await value.text()
  assert.equal(value.status, expected, body)
}

async function okJson(response: Promise<Response>, expected: number) {
  const value = await response
  assert.equal(value.status, expected)
  return value.json()
}

async function signIn(page: Page, origin: string) {
  await page.goto(origin)
  await page.getByRole('button', { name: '使用组织身份登录' }).click()
  await page.getByRole('link', { name: 'pilot-admin', exact: true }).click()
  const workspace = page.getByRole('combobox', { name: '当前工作空间' })
  await workspace.waitFor()
  // 数据库排序取决于运行环境；通过空间选择器定位试点甲，不依赖默认顺序。
  if (!(await page.getByRole('heading', { name: '试点甲空间', exact: true }).count())) {
    await workspace.click()
    await page.getByText('试点甲空间', { exact: true }).last().click()
  }
  await page.getByRole('heading', { name: '试点甲空间', exact: true }).waitFor()
}

async function smokeBrowser(origin: string) {
  const browser = await chromium.launch({ channel: 'chrome' })
  try {
    const page = await browser.newPage({
      ignoreHTTPSErrors: true,
      viewport: { width: 1440, height: 900 },
    })
    page.setDefaultTimeout(10000)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await signIn(page, origin)
    await page.getByText('com.harbor.synthetic', { exact: true }).waitFor()
    await page.getByRole('button', { name: '新建项目', exact: true }).click()
    await page.getByLabel('项目名称').fill('浏览器新建项目')
    await page.getByLabel('项目标识').fill('chrome-project')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await page.getByRole('button', { name: '浏览器新建项目', exact: true }).waitFor()
    await page.screenshot({ path: 'artifacts/hosted-directory-desktop.png' })

    await page.getByRole('combobox', { name: '当前工作空间' }).click()
    await page.getByText('试点乙空间', { exact: true }).last().click()
    await page.getByRole('heading', { name: '试点乙空间', exact: true }).waitFor()
    assert.equal(await page.getByText('com.harbor.synthetic', { exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: '新建项目', exact: true }).count(), 0)
    await page.getByRole('combobox', { name: '当前工作空间' }).click()
    await page.getByText('试点甲空间', { exact: true }).last().click()
    await page.getByRole('tab', { name: '成员', exact: true }).click()
    await page.getByRole('button', { name: '添加成员', exact: true }).click()
    await page.getByLabel('显示名称').fill('浏览器成员')
    await page.getByLabel('OIDC subject').fill('browser-synthetic-subject')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await page.getByText('浏览器成员', { exact: true }).waitFor()

    await page.setViewportSize({ width: 375, height: 812 })
    await page.getByRole('tab', { name: '项目与应用', exact: true }).click()
    await page.getByText('com.harbor.synthetic', { exact: true }).waitFor()
    const boxes = await page.evaluate(() => ({
      viewport: innerWidth,
      page: document.documentElement.scrollWidth,
      grid: document.querySelector('.hosted-directory')?.getBoundingClientRect().left,
      title: document.querySelector('h1')?.getBoundingClientRect().left,
    }))
    assert.equal(boxes.page, boxes.viewport)
    assert.ok(typeof boxes.title === 'number' && boxes.title === boxes.grid)
    await page.screenshot({ path: 'artifacts/hosted-directory-mobile.png' })
    await page.getByRole('button', { name: '退出登录' }).click()
    await page.getByRole('button', { name: '使用组织身份登录' }).waitFor()
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
  }
}
