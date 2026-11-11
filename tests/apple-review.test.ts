/** @description Apple 真实协议链路及控制面回归；合成材料、内存凭据和隔离文件，不访问真实商店。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile, stat } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { setup, confirmed } from './fixtures/release-plans.ts'
import { appleReviewTestClient, TestAppleReviewRunner } from './fixtures/apple-review.ts'
import {
  readAppleReviewCatalog,
  inspectAppleReview,
} from '../packages/provider-app-ship/src/apple-review-source.ts'
import { executeAppleReview } from '../packages/provider-app-ship/src/apple-review-execution.ts'
import { AppleReviewError } from '../packages/provider-app-ship/src/apple-review-client.ts'
import { ReleaseObservationService } from '../apps/api/src/release-observation.service.ts'
import { ReleaseObservationStore } from '../apps/api/src/release-observation-store.ts'
import { ReviewTrackingService } from '../apps/api/src/review-tracking.service.ts'
import { AppleReviewService } from '../apps/api/src/apple-review.service.ts'
import { profileRevision } from '../packages/provider-app-ship/src/credentials.ts'
import { createApp } from '../apps/api/src/app.ts'
import {
  isReleaseCenterResponse,
  isReviewTrackingResponse,
  isAppleReviewRecord,
  type AppleReviewRecord,
} from '../packages/contracts/src/index.ts'

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
    ['foreignBuild', true, 'target'],
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

test('发布中心汇总 iOS 审核与手动发布：只读、归属隔离、原始回执及历史观察独立', async (t) => {
  const f = await fixture(t)
  const app = await createApp(f.projects, {
    applicationStore: f.applicationsStore,
    releasePlans: f.plans,
    execution: f.execution,
    batches: f.batches,
    appleReview: f.service,
  })
  t.after(() => app.close())
  // 1. 每次汇总同时验证公开合同、文件零写入和零商店调用。
  const get = async () => {
    const before = await stat(f.file)
    const content = await readFile(f.file, 'utf8')
    const calls = f.n.calls.length
    const response = await app.inject({
      method: 'GET',
      url: '/api/release-center',
      headers: { host: '127.0.0.1' },
    })
    assert.equal(response.statusCode, 200)
    const body: unknown = response.json()
    assert.ok(isReleaseCenterResponse(body))
    assert.equal(await readFile(f.file, 'utf8'), content)
    assert.equal((await stat(f.file)).mtimeMs, before.mtimeMs, '读取不能进入写事务重写文件')
    assert.equal(f.n.calls.length, calls, '列表不得查询商店或派发执行')
    for (const secret of [
      'snapshot',
      'credentialReference',
      'profileRevision',
      'digest',
      'synthetic-plan-account',
    ])
      assert.equal(JSON.stringify(body).includes(secret), false)
    return body.items.filter((item) => item.kind === 'apple')
  }
  const p = f.args[1],
    a = f.args[2]
  // 2. 同一应用分别形成送审和批准后手动发布，来源观察不能覆盖原回执。
  const ready = await f.service.prepare(p, a, f.body)
  assert.equal((await get())[0]?.state, 'awaiting_confirmation')
  await f.service.execute(p, a, ready.id, { expectedDigest: ready.digest, acknowledged: true })
  await finished(f)
  f.n.options.state = 'PENDING_DEVELOPER_RELEASE'
  f.n.options.releaseType = 'MANUAL'
  await f.service.catalog(p, a, { bindingId: f.binding.id })
  const release = await f.service.prepare(p, a, {
    ...f.body,
    requestId: randomUUID(),
    action: 'release',
    notes: '',
  })
  await f.service.execute(p, a, release.id, { expectedDigest: release.digest, acknowledged: true })
  await finished(f)
  const rows = await get()
  assert.equal(rows.length, 2)
  assert.deepEqual(new Set(rows.map((item) => item.action)), new Set(['submit', 'release']))
  assert.ok(rows.every((item) => item.state === 'completed'))
  assert.equal(rows.find((item) => item.action === 'submit')?.code, 'submitted')
  assert.equal(
    rows.find((item) => item.action === 'submit')?.observation?.state,
    'PENDING_DEVELOPER_RELEASE',
  )
  assert.equal(rows.find((item) => item.action === 'release')?.code, 'release_requested')
  assert.equal((await f.store.appleReviews('another-workspace', p, a)).length, 0)
  assert.equal((await f.store.appleReviews('local', p, randomUUID())).length, 0)
  // 3. 安全投影拒绝额外材料与错误平台，历史源故障不能伪装为空记录。
  for (const patch of [
    { snapshot: ready.snapshot },
    { platform: 'android' },
    { channels: ['xiaomi'] },
    { action: 'upload' },
    { observation: { state: 'IN_REVIEW', checkedAt: ready.createdAt, raw: 'private' } },
    { reconciliation: { decision: 'present', source: 'store_api', checkedAt: ready.createdAt } },
  ])
    assert.equal(
      isReleaseCenterResponse({ projects: [], items: [{ ...rows[0], ...patch }] }),
      false,
    )
  // 任一审核历史源故障必须使汇总失败，不能静默变为空记录。
  const broken = new (
    await import('../apps/api/src/release-center.service.ts')
  ).ReleaseCenterService(f.projects, f.catalog, f.plans, f.batches, f.execution, {
    async list() {
      throw new Error('合成审核历史不可读')
    },
  })
  await assert.rejects(broken.list('local'), /合成审核历史不可读/)
})

test('发布中心未知与过期审核记录保持需处理，不将人工核对改写为执行成功', async (t) => {
  const f = await fixture(t, 'unknown')
  const service = new (
    await import('../apps/api/src/release-center.service.ts')
  ).ReleaseCenterService(f.projects, f.catalog, f.plans, f.batches, f.execution, f.service)
  const p = f.args[1],
    a = f.args[2]
  const ready = await f.service.prepare(p, a, f.body)
  await f.service.execute(p, a, ready.id, { expectedDigest: ready.digest, acknowledged: true })
  const result = await finished(f)
  await f.service.reconcile(p, a, ready.id, {
    expectedDigest: ready.digest,
    decision: 'absent',
    version: '1.2.3',
    build: '42',
    acknowledged: true,
  })
  // 插入合成的旧摘要保护过期显示；同一时间基准避免跨毫秒时窗口误超五分钟，原记录不改写。
  const expiredAt = Date.now() - 300000
  await f.store.execution(async (_plans, _attempts, _preparations, records) => {
    records.push({
      ...ready,
      id: randomUUID(),
      requestId: randomUUID(),
      createdAt: new Date(expiredAt - 300000).toISOString(),
      expiresAt: new Date(expiredAt).toISOString(),
    })
  })
  const rows = (await service.list('local')).items.filter((item) => item.kind === 'apple')
  assert.ok(rows.every((item) => item.state === 'attention'))
  const unknown = rows.find((item) => item.id === result.id)
  assert.equal(unknown?.status, 'unknown')
  assert.equal(unknown?.reconciliation?.decision, 'absent')
})

test('审核状态菜单纳入 Apple 已有观察，待开发者发布形成待办且导航不查询商店', async (t) => {
  const f = await fixture(t),
    p = f.args[1],
    a = f.args[2]
  const observations = new ReleaseObservationService(
    f.catalog,
    f.store,
    new ReleaseObservationStore(join(f.root, 'observations.json')),
    {
      async run() {
        throw Error('菜单不得查询商店')
      },
      close() {},
    },
  )
  const service = new ReviewTrackingService(
    f.projects,
    f.catalog,
    f.plans,
    f.execution,
    observations,
    f.service,
  )
  const ready = await f.service.prepare(p, a, f.body)
  assert.equal((await service.list()).items.length, 0)
  await f.service.execute(p, a, ready.id, { expectedDigest: ready.digest, acknowledged: true })
  await finished(f)
  f.n.options.state = 'PENDING_DEVELOPER_RELEASE'
  await f.service.catalog(p, a, { bindingId: f.binding.id })
  const calls = f.n.calls.length,
    original = await readFile(f.file, 'utf8')
  const response = await service.list()
  assert.ok(isReviewTrackingResponse(response))
  assert.equal(response.items.length, 1)
  assert.equal(response.items[0]?.kind, 'apple')
  assert.equal(response.items[0]?.state, 'approved')
  assert.equal(response.items[0]?.todo, 'manual_release')
  assert.equal(response.items[0]?.appleObservation?.state, 'PENDING_DEVELOPER_RELEASE')
  assert.equal(f.n.calls.length, calls)
  assert.equal(await readFile(f.file, 'utf8'), original)
  f.n.options.releaseType = 'MANUAL'
  const release = await f.service.prepare(p, a, {
    ...f.body,
    requestId: randomUUID(),
    action: 'release',
    notes: '',
  })
  await f.service.execute(p, a, release.id, { expectedDigest: release.digest, acknowledged: true })
  await finished(f)
  const after = await service.list()
  assert.equal(
    after.items.find((item) => item.id === ready.id)?.todo,
    'wait',
    '旧送审观察不能在手动发布已受理后再次催促发布',
  )
  assert.equal(after.items.find((item) => item.id === release.id)?.todo, 'wait')
})
