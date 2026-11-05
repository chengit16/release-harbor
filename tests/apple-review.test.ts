/** @description Apple 真实协议链路及控制面回归；合成材料、内存凭据和隔离文件，不访问真实商店。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { setup, confirmed } from './fixtures/release-plans.ts'
import { appleReviewTestClient, TestAppleReviewRunner } from './fixtures/apple-review.ts'
import {
  readAppleReviewCatalog,
  inspectAppleReview,
} from '../packages/provider-app-ship/src/apple-review-source.ts'
import { executeAppleReview } from '../packages/provider-app-ship/src/apple-review-execution.ts'
import { AppleReviewError } from '../packages/provider-app-ship/src/apple-review-client.ts'
import { AppleReviewService } from '../apps/api/src/apple-review.service.ts'
import { profileRevision } from '../packages/provider-app-ship/src/credentials.ts'
import { createApp } from '../apps/api/src/app.ts'
import { isAppleReviewRecord, type AppleReviewRecord } from '../packages/contracts/src/index.ts'

test('Apple 目录及只读准备严格匹配应用，缺项可操作且不泄露联系人或测试账号', async (t) => {
  const f = await setup(t),
    n = await appleReviewTestClient(
      join(f.root, 'vault', 'profiles.json'),
      f.binding,
      f.application.identifier,
    )
  const c = await readAppleReviewCatalog(n.client, f.binding, f.application.identifier)
  assert.equal(c.builds[0]?.number, '42')
  const prepare = () =>
    inspectAppleReview(
      n.client,
      f.binding,
      f.application.identifier,
      'B1',
      'V1',
      'submit',
      'manual',
      '修复问题',
      'a'.repeat(64),
    )
  const s = await prepare()
  assert.ok(!JSON.stringify(s.snapshot).includes('private-review'))
  assert.ok(!JSON.stringify(s.snapshot).includes('synthetic@example.com'))
  assert.ok(n.calls.every((v) => v.method === 'GET'))
  for (const [field, value, code] of [
    ['missingContact', true, 'review_contact'],
    ['missingImages', true, 'localization'],
    ['missingEncryption', true, 'compliance'],
    ['active', true, 'active_review'],
    ['foreign', true, 'target'],
    ['expired', true, 'build'],
    ['next', true, 'receipt'],
  ] as const) {
    n.options[field] = value
    await assert.rejects(prepare(), (e) => e instanceof AppleReviewError && e.code === code)
    n.options[field] = false
  }
  n.options.state = 'WAITING_FOR_REVIEW'
  await assert.rejects(prepare(), (e) => e instanceof AppleReviewError && e.code === 'version')
  assert.ok(n.calls.every((v) => v.method === 'GET'))
})

test('Apple 一次许可后设置构建、说明和自动／手动，再完整创建集合及送审；部分失败不重试', async (t) => {
  for (const mode of ['manual', 'after_approval'] as const) {
    const f = await setup(t),
      n = await appleReviewTestClient(
        join(f.root, 'vault', 'profiles.json'),
        f.binding,
        f.application.identifier,
      )
    const s = (
      await inspectAppleReview(
        n.client,
        f.binding,
        f.application.identifier,
        'B1',
        'V1',
        'submit',
        mode,
        '新版说明',
        'a'.repeat(64),
      )
    ).snapshot
    let permits = 0
    assert.equal(
      await executeAppleReview(
        n.client,
        s,
        async () => {
          permits++
        },
        () => undefined,
      ),
      'submitted',
    )
    assert.equal(permits, 1)
    const writes = n.calls.filter((v) => v.method !== 'GET')
    assert.deepEqual(
      writes.map((v) => v.path),
      [
        '/v1/appStoreVersions/V1',
        '/v1/appStoreVersionLocalizations/L1',
        '/v1/reviewSubmissions',
        '/v1/reviewSubmissionItems',
        '/v1/reviewSubmissions/R1',
      ],
    )
    assert.ok(
      JSON.stringify(writes[0]?.body).includes(mode === 'manual' ? 'MANUAL' : 'AFTER_APPROVAL'),
    )
    assert.ok(JSON.stringify(writes[0]?.body).includes('"earliestReleaseDate":null'))
    assert.ok(JSON.stringify(writes[0]?.body).includes('B1'))
  }
  const f = await setup(t),
    n = await appleReviewTestClient(
      join(f.root, 'vault', 'profiles.json'),
      f.binding,
      f.application.identifier,
    )
  const s = (
    await inspectAppleReview(
      n.client,
      f.binding,
      f.application.identifier,
      'B1',
      'V1',
      'submit',
      'manual',
      '说明',
      'a'.repeat(64),
    )
  ).snapshot
  n.options.pictureId = 'I2'
  await assert.rejects(
    executeAppleReview(
      n.client,
      s,
      async () => {
        throw Error('不应请求许可')
      },
      () => undefined,
    ),
    (e) => e instanceof AppleReviewError && e.code === 'changed',
  )
  n.options.pictureId = 'I1'
  n.options.notes = '后台修改'
  let permits = 0
  await assert.rejects(
    executeAppleReview(
      n.client,
      s,
      async () => {
        permits++
      },
      () => undefined,
    ),
    (e) => e instanceof AppleReviewError && e.code === 'changed',
  )
  assert.equal(permits, 0)
  n.options.notes = '旧说明'
  n.options.failPath = '/v1/reviewSubmissionItems'
  await assert.rejects(
    executeAppleReview(
      n.client,
      s,
      async () => {
        permits++
      },
      () => undefined,
    ),
    (e) => e instanceof AppleReviewError && e.code === 'rejected',
  )
  assert.equal(permits, 1)
  assert.equal(n.calls.filter((v) => v.path === '/v1/reviewSubmissionItems').length, 1)
  assert.equal(
    n.calls.filter((v) => v.method === 'PATCH' && v.path === '/v1/reviewSubmissions/R1').length,
    0,
  )
})

test('Apple 手动发布必须已批准且关联构建匹配，独立许可且不重复送审或上传', async (t) => {
  const f = await setup(t),
    n = await appleReviewTestClient(
      join(f.root, 'vault', 'profiles.json'),
      f.binding,
      f.application.identifier,
    )
  await assert.rejects(
    inspectAppleReview(
      n.client,
      f.binding,
      f.application.identifier,
      'B1',
      'V1',
      'release',
      'manual',
      '',
      'a'.repeat(64),
    ),
  )
  n.options.state = 'PENDING_DEVELOPER_RELEASE'
  n.options.releaseType = 'MANUAL'
  const s = (
    await inspectAppleReview(
      n.client,
      f.binding,
      f.application.identifier,
      'B1',
      'V1',
      'release',
      'manual',
      '',
      'a'.repeat(64),
    )
  ).snapshot
  let permits = 0
  assert.equal(
    await executeAppleReview(
      n.client,
      s,
      async () => {
        permits++
      },
      () => undefined,
    ),
    'release_requested',
  )
  assert.equal(permits, 1)
  assert.deepEqual(
    n.calls.filter((v) => v.method !== 'GET').map((v) => v.path),
    ['/v1/appStoreVersionReleaseRequests'],
  )
})

async function fixture(
  t: Parameters<typeof setup>[0],
  kind: 'success' | 'unknown' | 'no_permit' = 'success',
) {
  const f = await setup(t),
    vault = join(f.root, 'vault', 'profiles.json'),
    n = await appleReviewTestClient(vault, f.binding, f.application.identifier)
  const rev = await profileRevision(vault)
  const profile = f.profiles.profiles[0]
  assert.ok(profile)
  profile.revision = rev
  const runner = new TestAppleReviewRunner(
    async (job) => {
      try {
        if (job.kind === 'catalog')
          return {
            ok: true,
            value: await readAppleReviewCatalog(n.client, job.binding, job.identifier),
          }
        if (job.kind === 'prepare')
          return {
            ok: true,
            value: (
              await inspectAppleReview(
                n.client,
                job.binding,
                job.identifier,
                job.buildId,
                job.versionId,
                job.action,
                job.mode,
                job.notes,
                rev,
              )
            ).snapshot,
          }
        return { ok: false, code: 'network' }
      } catch (e) {
        return { ok: false, code: e instanceof AppleReviewError ? e.code : 'network' }
      }
    },
    async (s, permit) => {
      if (kind === 'no_permit') return { ok: false, code: 'changed' }
      await permit()
      return kind === 'unknown'
        ? { ok: false, code: 'network' }
        : { ok: true, value: s.action === 'submit' ? 'submitted' : 'release_requested' }
    },
  )
  let clock = Date.now()
  const service = new AppleReviewService(f.catalog, f.preflights, f.store, runner, () => clock)
  t.after(() => service.onModuleDestroy())
  const body = {
    requestId: randomUUID(),
    bindingId: f.binding.id,
    buildId: 'B1',
    versionId: 'V1',
    action: 'submit',
    mode: 'manual',
    notes: '本次修复',
  }
  return {
    ...f,
    n,
    runner,
    service,
    body,
    advanceReview: (ms: number) => {
      clock += ms
    },
  }
}
async function finished(f: Awaited<ReturnType<typeof fixture>>): Promise<AppleReviewRecord> {
  for (let i = 0; i < 80; i++) {
    const r = (await f.service.list(f.args[1], f.args[2]))[0]
    if (r?.finishedAt) return r
    await delay(5)
  }
  throw Error('未结束')
}

test('Apple API 来源与归属保护，一次确认并发只派发一次，刷新观察不重放，快照不可修改', async (t) => {
  const f = await fixture(t),
    p = f.args[1],
    a = f.args[2]
  const app = await createApp(f.projects, {
    applicationStore: f.applicationsStore,
    releasePlans: f.plans,
    appleReview: f.service,
  })
  t.after(() => app.close())
  const base = `/api/projects/${p}/applications/${a}/apple-review`
  const rejected = await app.inject({
    method: 'POST',
    url: base + '/prepare',
    headers: { host: '127.0.0.1' },
    payload: f.body,
  })
  assert.equal(rejected.statusCode, 403)
  const r = await f.service.prepare(p, a, f.body)
  assert.equal((await f.service.prepare(p, a, f.body)).id, r.id)
  await assert.rejects(f.service.prepare(p, a, { ...f.body, notes: '不同意图' }), /请求编号/)
  const body = { expectedDigest: r.digest, acknowledged: true }
  await assert.rejects(f.service.execute('foreign', a, r.id, body), /不存在/)
  await Promise.all([f.service.execute(p, a, r.id, body), f.service.execute(p, a, r.id, body)])
  const end = await finished(f)
  assert.equal(end.code, 'submitted')
  assert.equal(f.runner.executes, 1)
  assert.ok(isAppleReviewRecord(end))
  f.n.options.state = 'WAITING_FOR_REVIEW'
  await f.service.catalog(p, a, { bindingId: f.binding.id })
  const observed = (await f.service.list(p, a))[0]
  assert.equal(observed?.observation?.state, 'WAITING_FOR_REVIEW')
  assert.equal(observed?.code, 'submitted')
  await f.service.execute(p, a, r.id, body)
  assert.equal(f.runner.executes, 1)
  await assert.rejects(
    f.store.execution(async (_p, _a, _q, records) => {
      const record = records[0]
      assert.ok(record)
      record.snapshot.notes = '覆盖'
    }),
    /无效计划变更/,
  )
})

test('Apple 未知结果及上传共用阻塞，人工结论只追加；写前失败可新建意图，损坏不覆盖', async (t) => {
  const f = await fixture(t, 'unknown'),
    p = f.args[1],
    a = f.args[2]
  const r = await f.service.prepare(p, a, f.body)
  await f.service.execute(p, a, r.id, { expectedDigest: r.digest, acknowledged: true })
  const end = await finished(f)
  assert.equal(end.status, 'unknown')
  const r2 = await f.service.prepare(p, a, { ...f.body, requestId: randomUUID() })
  await assert.rejects(
    f.service.execute(p, a, r2.id, { expectedDigest: r2.digest, acknowledged: true }),
    /待核对/,
  )
  const profile = f.profiles.profiles[0]
  assert.ok(profile)
  profile.revision = 'a'.repeat(64)
  const upload = await confirmed(f)
  await assert.rejects(
    f.execution.start(...f.args, upload.id, { expectedDigest: upload.digest, acknowledged: true }),
    /待核对/,
  )
  await f.service.reconcile(p, a, end.id, {
    expectedDigest: end.digest,
    decision: 'absent',
    version: '1.2.3',
    build: '42',
    acknowledged: true,
  })
  await assert.rejects(
    f.service.reconcile(p, a, end.id, {
      expectedDigest: end.digest,
      decision: 'present',
      version: '1.2.3',
      build: '42',
      acknowledged: true,
    }),
    /不能覆盖/,
  )
  const raw = await readFile(f.file, 'utf8')
  assert.ok(!raw.includes('private-review-password'))
  await writeFile(f.file, 'invalid')
  await assert.rejects(f.service.list(p, a), /无法读取/)
  assert.equal(await readFile(f.file, 'utf8'), 'invalid')
})

test('Apple 私有协议允许实际八字段准备载荷，拒绝额外字段和路径注入', async (t) => {
  const { isAppleReviewJob, isAppleReviewReply } = await import(
    '../packages/runner-local/src/apple-review-protocol.ts'
  )
  const f = await setup(t)
  const job = {
    kind: 'prepare',
    binding: f.binding,
    identifier: f.application.identifier,
    buildId: 'B1',
    versionId: 'V1',
    action: 'submit',
    mode: 'manual',
    notes: '本次说明',
  }
  assert.equal(isAppleReviewJob(job), true)
  assert.equal(isAppleReviewJob({ ...job, path: '/private' }), false)
  assert.equal(isAppleReviewJob({ ...job, buildId: '../other' }), false)
  assert.equal(isAppleReviewJob({ ...job, mode: 'scheduled' }), false)
  assert.equal(isAppleReviewReply({ ok: true, value: { token: 'private' } }), false)
})

test('Apple 固定 worker 无档案时失败且不访问商店，关闭后不能派发', async (t) => {
  const { LocalAppleReviewRunner } = await import(
    '../packages/runner-local/src/apple-review-runner.ts'
  )
  const f = await setup(t)
  const runner = new LocalAppleReviewRunner(join(f.root, 'absent', 'profiles.json'))
  t.after(() => runner.close())
  const result = await runner.run({
    kind: 'catalog',
    binding: f.binding,
    identifier: f.application.identifier,
  })
  assert.deepEqual(result, { ok: false, code: 'credentials' })
  runner.close()
  assert.deepEqual(
    await runner.run({ kind: 'catalog', binding: f.binding, identifier: f.application.identifier }),
    { ok: false, code: 'interrupted' },
  )
})

test('Apple 期限和绑定／目录变化不消费，重启恢复不重放，许可事实决定未知或中断', async (t) => {
  const f = await fixture(t),
    p = f.args[1],
    a = f.args[2]
  const r = await f.service.prepare(p, a, f.body)
  f.advanceReview(300001)
  await assert.rejects(
    f.service.execute(p, a, r.id, { expectedDigest: r.digest, acknowledged: true }),
    /过期/,
  )
  assert.equal((await f.service.list(p, a))[0]?.consumedAt, null)
  for (const remote of [false, true]) {
    const g = await fixture(t),
      v = await g.service.prepare(g.args[1], g.args[2], g.body)
    await g.store.execution(async (_p, _a, _q, records) => {
      const record = records.find((candidate) => candidate.id === v.id)
      assert.ok(record)
      record.status = 'running'
      record.code = 'running'
      record.consumedAt = new Date().toISOString()
      record.remoteStartedAt = remote ? record.consumedAt : null
    })
    const restarted = new AppleReviewService(g.catalog, g.preflights, g.store, g.runner)
    t.after(() => restarted.onModuleDestroy())
    const result = (await restarted.list(g.args[1], g.args[2]))[0]
    assert.equal(result?.status, remote ? 'unknown' : 'interrupted')
    assert.equal(g.runner.executes, 0)
  }
  const g = await fixture(t),
    s = await g.service.prepare(g.args[1], g.args[2], g.body)
  const profile = g.profiles.profiles[0]
  assert.ok(profile)
  profile.revision = 'b'.repeat(64)
  await assert.rejects(
    g.service.execute(g.args[1], g.args[2], s.id, { expectedDigest: s.digest, acknowledged: true }),
    /变化/,
  )
  assert.equal((await g.service.list(g.args[1], g.args[2]))[0]?.consumedAt, null)
})
