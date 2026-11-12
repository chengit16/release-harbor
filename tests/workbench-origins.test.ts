/** @description 从真实启动入口核对来源策略，使用空数据目录与无效意图，禁止触发真实商店操作。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { get, request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { TestContext } from 'node:test'
import { LocalTeamStore } from '../apps/api/src/local-team/store.ts'

async function availablePort(): Promise<number> {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
  return address.port
}

function startChild(
  t: TestContext,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd?: string,
): (ready: () => Promise<boolean>) => Promise<void> {
  const child = spawn(process.execPath, args, {
    env,
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()))
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      child.kill('SIGTERM')
      await exited
    }
  })
  return async (ready) => {
    for (let i = 0; i < 100; i++) {
      assert.equal(child.exitCode, null, output)
      if (await ready().catch(() => false)) return
      await delay(100)
    }
    assert.fail('测试服务未启动：' + output)
  }
}

async function startApi(t: TestContext, origin = '') {
  const root = await mkdtemp(join(tmpdir(), 'harbor-origins-'))
  const port = await availablePort()
  const base = `http://127.0.0.1:${port}`
  const env = {
    ...process.env,
    RELEASE_HARBOR_DATA_DIR: root,
    RELEASE_HARBOR_PORT: String(port),
    RELEASE_HARBOR_MODE: 'local',
    RELEASE_HARBOR_TUNNEL_ORIGIN: origin,
  }
  const ready = startChild(t, ['--import', 'tsx', 'apps/api/src/main.ts'], env)
  t.after(() => rm(root, { recursive: true, force: true }))
  await ready(async () => (await fetch(base + '/api/health')).ok)
  return { root, port, base, env }
}

// 长函数保留原因：各来源与端点共用同一真实宿主生命周期，按阶段验证装配与拒绝边界。
test('真实宿主的本机业务来源一致，不能绕过明确标记', async (t) => {
  // 1. 使用生产装配，防止测试夹具自行补全白名单而掩盖 main.ts 的遗漏。
  const { base, port } = await startApi(t)

  // 2. 目标固定不存在，正文故意无效；只验证到达归属／格式校验，不创建许可或请求商店。
  const app = '/api/projects/origin-probe/applications/origin-probe'
  const cases = [
    ['/api/local/reuse/origin-probe/origin-probe', 'local'],
    ['/api/local/reuse/origin-probe/origin-probe/delete', 'local'],
    ['/api/local/settings', 'local'],
    ['/api/local/backups', 'local'],
    ['/api/local/restore-preview', 'local'],
    ['/api/local/restore', 'local'],
    ['/api/local/follows', 'local'],
    ['/api/local/follows/missing', 'local'],
    ['/api/local/protections/reconcile', 'local'],
    ['/api/local/artifacts/cleanup', 'local'],
    ['/api/local/backups/delete', 'local'],
    [`${app}/release-batches`, 'plan'],
    [`${app}/release-batches/missing/prepare`, 'plan'],
    [`${app}/release-batches/missing/revisions/missing/confirm-and-start`, 'plan'],
    [`${app}/release-batches/missing/runs/missing/stop`, 'plan'],
    [`${app}/release-preparations`, 'plan'],
    [`${app}/release-plans`, 'plan'],
    [`${app}/release-plans/missing/confirm`, 'plan'],
    [`${app}/release-plans/missing/cancel`, 'plan'],
    [`${app}/release-plans/missing/confirm-and-execute`, 'plan'],
    [`${app}/release-plans/missing/execute`, 'plan'],
    [`${app}/release-plans/missing/observations`, 'plan'],
    [`${app}/release-attempts/missing/reconcile`, 'plan'],
    [`${app}/apple-review/catalog`, 'plan'],
    [`${app}/apple-review/prepare`, 'plan'],
    [`${app}/apple-review/missing/execute`, 'plan'],
    [`${app}/apple-review/missing/reconcile`, 'plan'],
    ['/api/store-status/origin-probe/origin-probe/missing/query', 'query'],
    ['/api/store-status/origin-probe/origin-probe/missing/materials', 'query'],
    ['/api/store-status/origin-probe/origin-probe/missing/manual', 'query'],
  ] as const
  const origins = [
    base,
    `http://localhost:${port}`,
    'http://127.0.0.1:5178',
    'http://localhost:5178',
  ]
  for (const origin of origins) {
    await t.test(origin, async () => {
      for (const [path, marker] of cases) {
        const response = await fetch(base + path, {
          method: 'POST',
          headers: {
            origin,
            'content-type': 'application/json',
            [`x-release-harbor-${marker}`]: '1',
          },
          body: path === '/api/local/backups' ? '{"invalid":true}' : '{}',
        })
        const body: unknown = await response.json()
        assert.ok(
          response.status === 400 || response.status === 404,
          `${origin} ${path}: ${response.status} ${JSON.stringify(body)}`,
        )
        const missingMarker = await fetch(base + path, {
          method: 'POST',
          headers: { origin, 'content-type': 'application/json' },
          body: '{}',
        })
        assert.equal(missingMarker.status, 403, path)
        await missingMarker.body?.cancel()
        const missingOrigin = await fetch(base + path, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            [`x-release-harbor-${marker}`]: '1',
          },
          body: '{}',
        })
        assert.equal(missingOrigin.status, 403, path)
        await missingOrigin.body?.cancel()
      }
    })
  }

  // 3. 任意域名、伪装子域和不透明来源均不能因隧道支持获得访问。
  for (const origin of [
    'https://untrusted.example',
    'https://releases.example.untrusted.example',
    'null',
  ]) {
    const response = await fetch(`${base}/api/health`, { headers: { origin } })
    assert.equal(response.status, 403)
    await response.body?.cancel()
  }
  // Node fetch 可能重写 Host；使用原生 HTTP 保证拒绝测试实际发送指定的头。
  const remoteHostStatus = await new Promise<number | undefined>((resolve, reject) => {
    get(`${base}/api/health`, { headers: { host: 'releases.example' } }, (response) => {
      response.resume()
      response.on('end', () => resolve(response.statusCode))
      response.on('error', reject)
    }).on('error', reject)
  })
  assert.equal(remoteHostStatus, 403)

  // 4. 本机账号入口保留独立校验，不接受外部页面来源。
  for (const path of ['/api/local-credential-sessions', '/api/credential-account-actions']) {
    for (const origin of ['https://releases.example', base]) {
      const response = await fetch(base + path, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json', 'x-release-harbor-setup': '1' },
        body: '{}',
      })
      assert.equal(response.status, origin === base ? 400 : 403, path)
      await response.body?.cancel()
    }
  }
})

test('更换隧道域名只需配置新 HTTPS 来源，保留 Host 并使用团队会话', async (t) => {
  const host = 'rotated-workbench.example'
  const origin = `https://${host}`
  const password = ['synthetic', 'team', 'tunnel'].join('-')
  const { root, port, env } = await startApi(t, origin)
  const team = new LocalTeamStore(root)
  // 1. 真实 HTTP 保留代理传入的 Host；只访问隔离宿主，不解析或连接测试域名。
  const send = (path: string, headers: Record<string, string>, body?: object, target = port) =>
    new Promise<{ status?: number; body: string; cookies?: string[] }>((resolve, reject) => {
      const call = request(
        {
          hostname: '127.0.0.1',
          port: target,
          path: '/api/' + path,
          method: body ? 'POST' : 'GET',
          headers: { host, ...headers, ...(body ? { 'content-type': 'application/json' } : {}) },
        },
        (response) => {
          let text = ''
          response.setEncoding('utf8')
          response.on('data', (chunk: string) => (text += chunk))
          response.on('end', () =>
            resolve({
              status: response.statusCode,
              body: text,
              cookies: response.headers['set-cookie'],
            }),
          )
          response.on('error', reject)
        },
      )
      call.on('error', reject)
      call.end(body ? JSON.stringify(body) : undefined)
    })
  assert.equal((await send('projects', {})).status, 403)
  assert.deepEqual(JSON.parse((await send('team/session', { host: `127.0.0.1:${port}` })).body), {
    mode: 'personal',
  })
  await team.initialize('admin', password)
  // 2. 团队模式要求同源和显式标记，其他域名不能通过转发头代替配置。
  const session = await send('team/session', {})
  assert.equal(session.status, 200, session.body)
  assert.deepEqual(JSON.parse(session.body), { mode: 'signed_out' })
  assert.equal((await send('projects', {})).status, 401)
  for (const wrongHost of ['old-workbench.example', host + '.other.example']) {
    assert.equal(
      (await send('team/session', { host: wrongHost, 'x-forwarded-host': host })).status,
      403,
    )
  }
  const login = { username: 'admin', password }
  const teamMarker = { 'x-release-harbor-team': '1' }
  for (const wrongOrigin of ['https://old-workbench.example', 'http://' + host, 'null']) {
    assert.equal(
      (await send('team/login', { origin: wrongOrigin, ...teamMarker }, login)).status,
      403,
    )
  }
  assert.equal((await send('team/login', teamMarker, login)).status, 403)
  assert.equal((await send('team/login', { origin }, login)).status, 403)
  const rewritten = await send(
    'team/login',
    { host: `127.0.0.1:${port}`, origin, ...teamMarker },
    login,
  )
  assert.equal(rewritten.status, 403)
  assert.match(rewritten.body, /保留原始 Host/)
  // 3. 实际 Vite 入口读取同一配置；其代理若改写 Host，同源登录便会失败。
  const webPort = await availablePort()
  const webReady = startChild(
    t,
    [
      'node_modules/vite/bin/vite.js',
      '--host',
      '127.0.0.1',
      '--port',
      String(webPort),
      '--strictPort',
    ],
    env,
    'apps/web',
  )
  await webReady(async () => (await send('health', { origin }, undefined, webPort)).status === 200)
  assert.equal(
    (await send('health', { host: 'old-workbench.example' }, undefined, webPort)).status,
    403,
  )
  const signedIn = await send('team/login', { origin, ...teamMarker }, login, webPort)
  assert.equal(signedIn.status, 200, signedIn.body)
  const setCookie = signedIn.cookies?.[0]
  assert.match(setCookie ?? '', /; Secure(?:;|$)/)
  const cookie = setCookie?.split(';')[0] ?? ''
  assert.equal((await send('projects', { cookie })).status, 200)
  // 4. 登录只通过身份边界，不能取消商店账号限制或替代发布操作标记。
  const setup = await send(
    'local-credential-sessions',
    { origin, cookie, 'x-release-harbor-setup': '1' },
    {},
  )
  assert.equal(setup.status, 403)
  assert.match(setup.body, /服务所在电脑/)
  const plan = 'projects/missing/applications/missing/release-preparations'
  const missing = await send(plan, { origin, cookie, 'x-release-harbor-plan': '1' }, {})
  assert.ok(missing.status === 400 || missing.status === 404, missing.body)
  assert.equal((await send(plan, { origin, cookie }, {})).status, 403)
  const logout = await send('team/logout', { origin, cookie, ...teamMarker }, {})
  assert.equal(logout.status, 200, logout.body)
  assert.match(logout.cookies?.[0] ?? '', /Max-Age=0; Secure/)
  assert.equal((await send('projects', { cookie })).status, 401)
})
