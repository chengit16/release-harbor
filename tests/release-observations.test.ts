/** @description 第三期版本观察回归；全部使用隔离目录、合成凭据与受控网络，禁止访问真实商店。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { setup, confirmed, terminal } from './fixtures/release-plans.ts'
import { MemoryCredentialSecrets } from './fixtures/credential-intake.ts'
import { credentialStore } from '../packages/provider-app-ship/src/credentials.ts'
import { observeHonorRelease } from '../packages/provider-app-ship/src/honor-status.ts'
import { honorApp } from './fixtures/store-updates.ts'
import { ReleaseObservationService } from '../apps/api/src/release-observation.service.ts'
import { ReleaseObservationStore } from '../apps/api/src/release-observation-store.ts'
import { createApp } from '../apps/api/src/app.ts'
import {
  isReleaseObservation,
  isReleaseObservationResult,
  type ReleaseObservationResult,
} from '../packages/contracts/src/index.ts'
import { isReleaseObservationJob } from '../packages/runner-local/src/release-observation-protocol.ts'
import { LocalReleaseObservationRunner } from '../packages/runner-local/src/release-observation-runner.ts'

async function fixture(t: test.TestContext) {
  const f = await setup(
    t,
    'android',
    {
      async run(_p, _id, permit) {
        await permit()
        return 'honor_review_submitted'
      },
      close() {},
    },
    { channel: 'honor' },
  )
  const plan = await confirmed(f)
  await f.execution.start(...f.args, plan.id, { expectedDigest: plan.digest, acknowledged: true })
  await terminal(f)
  let clock = Date.now(),
    calls = 0
  const outcome: { value: ReleaseObservationResult } = {
    value: { state: 'in_review', code: 'observed', rawState: 0 },
  }
  const file = join(f.root, 'observations.json'),
    store = new ReleaseObservationStore(file)
  const service = new ReleaseObservationService(
    f.catalog,
    f.store,
    store,
    {
      async run() {
        calls++
        return outcome.value
      },
      close() {},
    },
    () => clock,
  )
  return {
    ...f,
    plan,
    file,
    observationStore: store,
    service,
    outcome,
    queries: () => calls,
    advanceQuery: (ms: number) => {
      clock += ms
    },
  }
}

test('荣耀只读状态精确匹配包名、App ID、版本和构建号；不公开意见或附件，不借用旧版本上架状态', async (t) => {
  const f = await setup(t, 'android', undefined, { channel: 'honor' }),
    store = credentialStore(join(f.root, 'vault/profiles.json'), new MemoryCredentialSecrets())
  await store.saveProfile({
    credentialProfile: f.binding.credentialReference,
    platform: 'honor',
    material: {
      fields: { clientId: 'synthetic-client', clientSecret: 'synthetic-secret' },
      files: {},
    },
  })
  const job = {
    binding: f.binding,
    identifier: f.application.identifier,
    versionName: '1.2.3',
    buildNumber: '42',
  }
  let audit = 0,
    version = '1.2.3',
    build = '42',
    published = false,
    foreign = false,
    fail = false
  const methods: string[] = []
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input))
    methods.push(`${init?.method ?? 'GET'} ${url.pathname}`)
    if (fail) return new Response('private-error-sentinel', { status: 403 })
    if (url.origin === 'https://iam.developer.honor.com' && url.pathname === '/auth/token')
      return Response.json({ access_token: 'synthetic-token' })
    assert.equal(url.origin, 'https://appmarket-openapi-drcn.cloud.honor.com')
    assert.equal(init?.method, 'GET')
    if (url.pathname.endsWith('get-app-id'))
      return Response.json({
        code: 0,
        data: [{ packageName: job.identifier, appId: foreign ? 8888 : 123456 }],
      })
    if (url.pathname.endsWith('get-app-detail'))
      return Response.json({
        code: 0,
        data: {
          ...honorApp(job.identifier),
          releaseInfo: published
            ? { versionName: job.versionName, versionCode: 42 }
            : { versionName: '1.0.0', versionCode: 6 },
        },
      })
    if (url.pathname.endsWith('get-app-current-release'))
      return Response.json({
        code: 0,
        data: {
          releaseId: 200,
          appId: 123456,
          versionName: version,
          versionCode: build,
          auditResult: audit,
          auditMessage: 'private-review-sentinel',
          auditAttachment: 'https://example.com/?private-token=secret',
        },
      })
    throw Error('禁止非白名单路由')
  }
  for (const [raw, state] of [
    [0, 'in_review'],
    [1, 'approved'],
    [2, 'rejected'],
    [3, 'unknown'],
    [4, 'unknown'],
    [77, 'unknown'],
  ] as const) {
    audit = raw
    assert.equal((await observeHonorRelease(store, job, transport)).state, state)
  }
  version = '1.0.0'
  assert.equal((await observeHonorRelease(store, job, transport)).code, 'version_mismatch')
  version = '1.2.3'
  build = '41'
  assert.equal((await observeHonorRelease(store, job, transport)).state, 'unknown')
  build = '42'
  published = true
  const live = await observeHonorRelease(store, job, transport)
  assert.equal(live.state, 'published')
  assert.ok(!JSON.stringify(live).includes('private'))
  foreign = true
  assert.equal((await observeHonorRelease(store, job, transport)).code, 'invalid_response')
  foreign = false
  fail = true
  assert.equal((await observeHonorRelease(store, job, transport)).code, 'authentication')
  assert.ok(methods.every((method) => method.startsWith('GET ') || method === 'POST /auth/token'))
})

test('状态观察来源、归属及零写入历史；并发查询去重，错误保留旧观察，终态不再查询', async (t) => {
  const f = await fixture(t),
    p = f.args[1],
    a = f.args[2]
  const app = await createApp(f.projects, {
    applicationStore: f.applicationsStore,
    releasePlans: f.plans,
    observations: f.service,
  })
  t.after(() => app.close())
  const path = `${f.base}/${f.plan.id}/observations`
  const wrong = await app.inject({
    method: 'POST',
    url: path,
    payload: {},
    headers: { host: '127.0.0.1' },
  })
  assert.equal(wrong.statusCode, 403)
  assert.equal(f.queries(), 0)
  const extra = await app.inject({
    method: 'POST',
    url: path,
    payload: { appId: 'foreign' },
    headers: f.headers,
  })
  assert.equal(extra.statusCode, 400)
  assert.equal(f.queries(), 0)
  const original = await readFile(join(f.root, 'release-plans.json'), 'utf8')
  const results = await Promise.allSettled([
    f.service.query(p, a, f.plan.id),
    f.service.query(p, a, f.plan.id),
  ])
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  assert.equal(f.queries(), 1)
  const before = await stat(f.file)
  const history = await app.inject({ method: 'GET', url: path, headers: { host: '127.0.0.1' } })
  assert.equal(history.statusCode, 200)
  assert.ok(isReleaseObservation(history.json().items[0]))
  assert.equal(f.queries(), 1)
  assert.equal((await stat(f.file)).mtimeMs, before.mtimeMs)
  await assert.rejects(f.service.list(p, randomUUID(), f.plan.id), /不存在/)
  assert.deepEqual(await f.observationStore.list('foreign', p, a), [])
  f.advanceQuery(10800001)
  f.outcome.value = { state: 'unknown', code: 'network', rawState: null }
  await f.service.query(p, a, f.plan.id)
  assert.equal((await f.service.list(p, a, f.plan.id)).length, 2)
  assert.equal((await f.service.list(p, a, f.plan.id))[1]?.state, 'in_review')
  await assert.rejects(f.service.query(p, a, f.plan.id), /下次可查询/)
  f.advanceQuery(60001)
  f.outcome.value = { state: 'approved', code: 'observed', rawState: 1 }
  await f.service.query(p, a, f.plan.id)
  await assert.rejects(f.service.query(p, a, f.plan.id), /下次可查询/)
  f.advanceQuery(10800001)
  f.outcome.value = { state: 'published', code: 'observed', rawState: null }
  const published = await f.service.query(p, a, f.plan.id)
  assert.equal(published.source, 'honor_published_version')
  assert.equal((await f.service.query(p, a, f.plan.id)).id, published.id)
  assert.equal(f.queries(), 4)
  assert.equal(
    await readFile(join(f.root, 'release-plans.json'), 'utf8'),
    original,
    '观察不得修改执行或确认事实',
  )
  await f.catalog.updateBinding('local', p, a, f.binding.id, {
    appId: f.binding.appId,
    credentialReference: f.binding.credentialReference,
    expectedRevision: f.binding.revision,
  })
  await assert.rejects(f.service.query(p, a, f.plan.id), /绑定已变化/)
  await writeFile(f.file, '{broken')
  await assert.rejects(f.service.list(p, a, f.plan.id), /无法读取/)
  assert.equal(await readFile(f.file, 'utf8'), '{broken')
})

test('状态查询拒绝未执行目标，重启保留预约，私有协议与 worker 不提供上传能力', async (t) => {
  const f = await fixture(t),
    p = f.args[1],
    a = f.args[2]
  const pending = await f.plans.freeze(...f.args, { ...f.input, requestId: randomUUID() })
  await assert.rejects(f.service.query(p, a, pending.id), /执行结束/)
  const now = new Date().toISOString()
  await f.observationStore.reserve('local', 'honor:123456', now)
  const restart = new ReleaseObservationStore(f.file)
  await assert.rejects(restart.reserve('local', 'honor:123456', now), /下次可查询/)
  assert.deepEqual(await restart.list('local', p, a), [])
  const job = {
    binding: f.binding,
    identifier: f.application.identifier,
    versionName: '1.2.3',
    buildNumber: '42',
  }
  assert.ok(isReleaseObservationJob(job))
  assert.equal(isReleaseObservationJob({ ...job, url: 'https://example.com' }), false)
  assert.equal(
    isReleaseObservationResult({ state: 'published', code: 'network', rawState: null }),
    false,
  )
  assert.equal(
    isReleaseObservationResult({
      state: 'unknown',
      code: 'network',
      rawState: null,
      secret: 'forbidden',
    }),
    false,
  )
  const runner = new LocalReleaseObservationRunner(join(f.root, 'missing/profiles.json'))
  t.after(() => runner.close())
  const result = await runner.run(job)
  assert.equal(result.state, 'unknown')
  runner.close()
  assert.equal((await runner.run(job)).code, 'interrupted')
})
