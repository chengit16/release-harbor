/** @description 从真实启动入口核对来源策略，使用空数据目录与无效意图，禁止触发真实商店操作。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { get } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

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

// 长函数保留原因：各来源与端点共用同一真实宿主生命周期，按阶段验证装配与拒绝边界。
test('真实宿主的全局与业务来源一致，固定隧道可操作且不能绕过明确标记', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'harbor-origins-'))
  const port = await availablePort()
  const base = `http://127.0.0.1:${port}`
  const child = spawn(process.execPath, ['--import', 'tsx', 'apps/api/src/main.ts'], {
    env: {
      ...process.env,
      RELEASE_HARBOR_DATA_DIR: root,
      RELEASE_HARBOR_PORT: String(port),
      RELEASE_HARBOR_MODE: 'local',
    },
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
    await rm(root, { recursive: true, force: true })
  })
  // 1. 使用生产装配，防止测试夹具自行补全白名单而掩盖 main.ts 的遗漏。
  let ready = false
  for (let i = 0; i < 100; i++) {
    assert.equal(child.exitCode, null, output)
    ready = await fetch(`${base}/api/health`).then(
      (r) => r.ok,
      () => false,
    )
    if (ready) break
    await delay(100)
  }
  assert.ok(ready, output)

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
    'https://6e03b6cd.r20.vip.cpolar.cn',
    'https://13231goev5981.vicp.fun',
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
    'https://6e03b6cd.r20.vip.cpolar.cn.untrusted.example',
    'null',
  ]) {
    const response = await fetch(`${base}/api/health`, { headers: { origin } })
    assert.equal(response.status, 403)
    await response.body?.cancel()
  }
  // Node fetch 可能重写 Host；使用原生 HTTP 保证拒绝测试实际发送指定的头。
  const remoteHostStatus = await new Promise<number | undefined>((resolve, reject) => {
    get(`${base}/api/health`, { headers: { host: '6e03b6cd.r20.vip.cpolar.cn' } }, (response) => {
      response.resume()
      response.on('end', () => resolve(response.statusCode))
      response.on('error', reject)
    }).on('error', reject)
  })
  assert.equal(remoteHostStatus, 403)

  // 4. 隧道只扩展普通业务；配置材料的私有 worker 仍只接受服务所在电脑的回环来源。
  for (const path of ['/api/local-credential-sessions', '/api/credential-account-actions']) {
    for (const origin of ['https://6e03b6cd.r20.vip.cpolar.cn', base]) {
      const response = await fetch(base + path, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json', 'x-release-harbor-setup': '1' },
        body: '{}',
      })
      assert.equal(response.status, origin === base ? 400 : 403, path)
      if (origin !== base) assert.match(await response.text(), /服务所在电脑/)
      else await response.body?.cancel()
    }
  }
})
