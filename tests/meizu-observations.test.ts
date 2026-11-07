/** @description 魅族版本锚点与状态查询回归；隔离存储、合成材料及受控只读网络，不请求真实商店。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { setup, confirmed, terminal } from './fixtures/release-plans.ts'
import { MemoryCredentialSecrets } from './fixtures/credential-intake.ts'
import { credentialStore } from '../packages/provider-app-ship/src/credentials.ts'
import { observeMeizuRelease } from '../packages/provider-app-ship/src/meizu-status.ts'
import { ReleaseObservationService } from '../apps/api/src/release-observation.service.ts'
import { ReleaseObservationStore } from '../apps/api/src/release-observation-store.ts'
import { ReviewTrackingService } from '../apps/api/src/review-tracking.service.ts'
import { FileReleasePlanStore } from '../apps/api/src/release-plan-store.ts'
import { isReleaseObservationJob } from '../packages/runner-local/src/release-observation-protocol.ts'
import {
  isReleaseAttempt,
  isReviewAnchor,
  isReviewTrackingResponse,
} from '../packages/contracts/src/index.ts'

test('魅族固定 verId 查询核对完整身份，安全映射官方状态且不借用其他版本或原始私密正文', async (t) => {
  const f = await setup(t, 'android', undefined, { channel: 'meizu' })
  const store = credentialStore(join(f.root, 'vault/profiles.json'), new MemoryCredentialSecrets())
  await store.saveProfile({
    credentialProfile: f.binding.credentialReference,
    platform: 'meizu',
    material: { fields: { clientId: 'synthetic-client', clientSecret: 'synthetic-secret' } },
  })
  const job = {
    binding: f.binding,
    identifier: f.application.identifier,
    versionName: '1.2.3',
    buildNumber: '42',
    reviewAnchor: { channel: 'meizu' as const, versionId: '200' },
  }
  let patch: Record<string, unknown> = {},
    fail = false
  const calls: string[] = []
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input))
    assert.equal(url.origin, 'https://developer.meizu.com')
    assert.equal(init?.method, 'GET')
    assert.equal(init.redirect, 'error')
    calls.push(url.pathname)
    if (fail) return new Response('private-error', { status: 403 })
    if (url.pathname.endsWith('/token'))
      return Response.json({ code: 200, value: { accessToken: 'synthetic-token' } })
    assert.equal(url.pathname, '/open/api/v1/app/detail')
    assert.equal(url.searchParams.get('verId'), '200')
    return Response.json({
      code: 200,
      value: {
        id: 123456,
        packageName: job.identifier,
        verId: 200,
        versionName: '1.2.3',
        status: 20,
        devContact: 'private-contact',
        packageUrl: 'https://example.com/?private-token',
        msg: 'private-review',
        ...patch,
      },
    })
  }
  for (const [status, state] of [
    [20, 'in_review'],
    [100, 'in_review'],
    [30, 'rejected'],
    [50, 'published'],
    [70, 'removed'],
    [999, 'unknown'],
  ] as const) {
    patch = { status }
    const result = await observeMeizuRelease(store, job, transport)
    assert.deepEqual(result, { state, code: 'observed', rawState: status })
    assert.ok(!JSON.stringify(result).includes('private'))
  }
  for (const bad of [
    { id: 888 },
    { packageName: 'other.app' },
    { verId: 100 },
    { status: '50' },
    { status: null },
    { status: 1001 },
  ]) {
    patch = bad
    assert.equal((await observeMeizuRelease(store, job, transport)).code, 'invalid_response')
  }
  patch = { versionName: '1.2.2', status: 50 }
  assert.equal((await observeMeizuRelease(store, job, transport)).code, 'version_mismatch')
  const before = calls.length
  assert.equal(
    (await observeMeizuRelease(store, { ...job, reviewAnchor: undefined }, transport)).code,
    'invalid_response',
  )
  assert.equal(calls.length, before, '缺失锚点不能按最新版本查询')
  assert.equal(isReleaseObservationJob(job), true)
  assert.equal(isReleaseObservationJob({ ...job, reviewAnchor: undefined }), false)
  assert.equal(isReleaseObservationJob({ ...job, url: 'https://example.com' }), false)
  assert.equal(isReviewAnchor({ channel: 'meizu', versionId: '200', token: 'private' }), false)
  fail = true
  assert.equal((await observeMeizuRelease(store, job, transport)).code, 'authentication')
  assert.ok(calls.every((c) => c.endsWith('/token') || c.endsWith('/detail')))
})

async function executed(t: test.TestContext, anchor = true) {
  const f = await setup(
    t,
    'android',
    {
      async run(_plan, _id, permit, _report, _batch, onAnchor) {
        await permit()
        if (anchor) onAnchor?.({ channel: 'meizu', versionId: '200' })
        return 'meizu_review_submitted'
      },
      close() {},
    },
    { channel: 'meizu' },
  )
  const plan = await confirmed(f)
  await f.execution.start(...f.args, plan.id, { expectedDigest: plan.digest, acknowledged: true })
  await terminal(f)
  let calls = 0,
    clock = Date.now(),
    status: 'in_review' | 'rejected' | 'unknown' = 'in_review'
  const observations = new ReleaseObservationStore(join(f.root, 'observations.json'))
  const service = new ReleaseObservationService(
    f.catalog,
    f.store,
    observations,
    {
      async run(job) {
        calls++
        assert.equal(job.reviewAnchor?.versionId, '200')
        assert.equal(job.buildNumber, '42')
        return status === 'unknown'
          ? { state: 'unknown', code: 'network', rawState: null }
          : { state: status, code: 'observed', rawState: status === 'in_review' ? 20 : 30 }
      },
      close() {},
    },
    () => clock,
  )
  return {
    ...f,
    plan,
    observations,
    service,
    calls: () => calls,
    advance: (ms: number) => {
      clock += ms
    },
    setState: (s: typeof status) => {
      status = s
    },
  }
}

test('魅族执行保存可信锚点，独立菜单查询不改原回执，冷却与失败保留历史', async (t) => {
  const f = await executed(t),
    [, p, a] = f.args
  const attempts = await f.store.attempts(...f.args)
  assert.deepEqual(attempts[0]?.reviewAnchor, { channel: 'meizu', versionId: '200' })
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).schemaVersion, 15)
  const before = await readFile(f.file, 'utf8'),
    mtime = (await stat(f.file)).mtimeMs
  const menu = new ReviewTrackingService(f.projects, f.catalog, f.plans, f.execution, f.service)
  const initial = await menu.list()
  assert.ok(isReviewTrackingResponse(initial))
  assert.equal(initial.items[0]?.querySupported, true)
  assert.equal(initial.items[0]?.todo, 'query')
  assert.equal(f.calls(), 0)
  const first = await f.service.query(p, a, f.plan.id)
  assert.equal(first.channel, 'meizu')
  assert.equal(first.source, 'meizu_version_detail')
  assert.equal(first.versionId, '200')
  assert.equal((await menu.list()).items[0]?.todo, 'wait')
  assert.ok(isReviewTrackingResponse(await menu.list()))
  await assert.rejects(f.service.query(p, a, f.plan.id), /下次可查询/)
  f.advance(10800001)
  f.setState('unknown')
  await f.service.query(p, a, f.plan.id)
  assert.equal((await f.service.list(p, a, f.plan.id))[1]?.id, first.id)
  f.advance(60001)
  f.setState('rejected')
  const rejected = await f.service.query(p, a, f.plan.id)
  assert.equal((await f.service.query(p, a, f.plan.id)).id, rejected.id)
  assert.equal(f.calls(), 3)
  assert.equal((await menu.list()).items[0]?.todo, 'review_rejection')
  assert.equal(await readFile(f.file, 'utf8'), before)
  assert.equal((await stat(f.file)).mtimeMs, mtime)
  const restarted = new FileReleasePlanStore(f.file)
  assert.deepEqual(
    (await restarted.attempts(...f.args))[0]?.reviewAnchor,
    attempts[0]?.reviewAnchor,
  )
  const disk = JSON.parse(before)
  disk.attempts[0].reviewAnchor.versionId = f.plan.snapshot.meizu?.sourceVersionId
  await writeFile(f.file, JSON.stringify(disk))
  await assert.rejects(restarted.attempts(...f.args), /无法读取/)
})

test('魅族旧回执缺锚点保持可读但零查询，不从名称回填；许可前回报不能附加锚点', async (t) => {
  const f = await executed(t, false),
    [, p, a] = f.args
  const disk = JSON.parse(await readFile(f.file, 'utf8'))
  disk.schemaVersion = 13
  await writeFile(f.file, JSON.stringify(disk))
  const before = await readFile(f.file, 'utf8')
  const menu = new ReviewTrackingService(f.projects, f.catalog, f.plans, f.execution, f.service)
  assert.equal((await menu.list()).items[0]?.querySupported, false)
  assert.equal((await menu.list()).items[0]?.todo, 'store_console')
  await assert.rejects(f.service.query(p, a, f.plan.id), /未保存送审版本 ID/)
  assert.equal(f.calls(), 0)
  assert.equal(await readFile(f.file, 'utf8'), before)
  assert.equal(
    isReleaseAttempt({
      ...disk.attempts[0],
      status: 'failed',
      code: 'verification_failed',
      remoteStartedAt: null,
      reviewAnchor: { channel: 'meizu', versionId: '200' },
    }),
    false,
  )
})
