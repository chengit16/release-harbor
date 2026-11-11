/** @description 在线专项的真实 PostgreSQL 隔离库、同源 HTTPS 代理和测试请求助手。 */
import { randomUUID } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { createServer } from 'node:https'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'
import { createHostedApp } from '../../apps/api/src/hosted/app.ts'
import { hostedCallback } from '../../apps/api/src/hosted/config.ts'
import { hostedPool, migrateHosted } from '../../apps/api/src/hosted/database.ts'
import { createHostedLogin } from '../../apps/api/src/hosted/oidc.ts'
import { HostedSessions } from '../../apps/api/src/hosted/session-store.ts'
import { listenTls, testIdentityProvider, testTls } from './hosted-oidc.ts'

/** 使用随机新库验证空库迁移，不读取或修改提供连接中的原有业务数据。 */
export async function hostedFixture(t: TestContext, database: string, web = false) {
  const { pool } = await isolatedDatabase(t, database)
  await migrateHosted(pool)
  await migrateHosted(pool)

  const tls = await testTls(t)
  const idp = await testIdentityProvider(t, tls)
  const proxy = createServer(tls, (req, res) => {
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port: backendPort,
        method: req.method,
        path: req.url,
        headers: req.headers,
      },
      (upstream) => {
        res.writeHead(upstream.statusCode ?? 502, upstream.headers)
        upstream.pipe(res)
      },
    )
    request.on('error', () => res.writeHead(502).end())
    req.pipe(request)
  })
  let backendPort = 0
  const origin = new URL('https://localhost:' + (await listenTls(proxy)))
  t.after(() => new Promise<void>((done) => proxy.close(() => done())))
  const login = await createHostedLogin({ ...idp, callback: hostedCallback(origin).href })
  const sessions = new HostedSessions(pool, login.issuer)
  const first = await sessions.bootstrap('pilot-one', '试点甲空间', 'pilot-admin', '甲管理员')
  const second = await sessions.bootstrap('pilot-two', '试点乙空间', 'other-admin', '乙管理员')

  const app = await createHostedApp({
    pool,
    origin,
    login,
    ...(web ? { webRoot: resolve('apps/web/hosted/dist') } : {}),
  })
  await app.listen(0, '127.0.0.1')
  const address = app.getHttpServer().address()
  assert.ok(address && typeof address === 'object')
  backendPort = address.port
  t.after(() => app.close())

  return {
    pool,
    first,
    second,
    origin: origin.origin,
    request(path: string, init: RequestInit = {}) {
      return fetch(new URL(path, origin), { redirect: 'manual', ...init })
    },
  }
}

async function isolatedDatabase(t: TestContext, database: string) {
  const admin = hostedPool(database)
  const name = 'harbor_hosted_test_' + randomUUID().replaceAll('-', '')
  await admin.query('CREATE DATABASE ' + name).catch(async (error: unknown) => {
    await admin.end()
    throw error
  })
  const address = new URL(database)
  address.pathname = '/' + name
  const pool = hostedPool(address.href)
  t.after(async () => {
    await pool.end()
    try {
      await admin.query('DROP DATABASE ' + name + ' WITH (FORCE)')
    } finally {
      await admin.end()
    }
  })
  return { pool }
}
