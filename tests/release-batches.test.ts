/** @description 批次隔离集成：同文件授权、串行、未知独立结果、停止竞争与历史恢复；不调用真实商店。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { AppleReviewService } from '../apps/api/src/apple-review.service.ts'
import { appleReviewTestClient, TestAppleReviewRunner } from './fixtures/apple-review.ts'
import { inspectAppleReview } from '../packages/provider-app-ship/src/apple-review-source.ts'
import { setup } from './fixtures/release-plans.ts'
import { meizuDetails } from './fixtures/store-updates.ts'
import { ReleaseBatchesService } from '../apps/api/src/release-batches.service.ts'
import { FileReleasePlanStore } from '../apps/api/src/release-plan-store.ts'
import type {
  BatchTargetInput,
  ReleaseBatch,
  BatchTargetValidation,
} from '../packages/contracts/src/index.ts'
import type { ReleaseExecutor } from '../packages/runner-local/src/index.ts'

async function fixture(t: test.TestContext, executor?: ReleaseExecutor) {
  const f = await setup(t, 'android', executor, {
    check: async (task) => ({
      code: 'verified',
      artifact: 'passed',
      authentication: 'passed',
      target: 'passed',
      ...(task?.channel === 'meizu' ? { meizu: meizuDetails } : {}),
    }),
  })
  const binding = await f.catalog.bind(...f.args, {
    channel: 'meizu',
    appId: '123456',
    credentialReference: 'synthetic-meizu-account',
  })
  f.profiles.profiles.push({
    reference: binding.credentialReference,
    channel: 'meizu',
    configured: true,
    revision: 'a'.repeat(64),
  })
  const targets: BatchTargetInput[] = [f.binding, binding].map((b) => ({
    bindingId: b.id,
    artifactId: f.artifact.id,
    expectedBindingRevision: b.revision,
    expectedArtifactSha256: f.artifact.sha256 ?? '',
    releaseNotes: '修复登录并优化启动体验',
    releasePolicy: { mode: 'after_approval' },
  }))
  return { ...f, targets, batchBase: f.base.replace(/release-plans$/, 'release-batches') }
}
async function wait(
  f: Awaited<ReturnType<typeof fixture>>,
  id: string,
  done: (b: ReleaseBatch) => boolean,
) {
  for (let n = 0; n < 400; n++) {
    const b = await f.batches.get(...f.args, id)
    if (done(b)) return b
    await delay(10)
  }
  throw Error('批次未结束')
}
async function prepared(f: Awaited<ReturnType<typeof fixture>>) {
  const b = await f.batches.create(...f.args, { requestId: randomUUID(), targets: f.targets })
  const body = { requestId: randomUUID(), expectedRevision: b.editVersion }
  await f.batches.prepare(...f.args, b.id, body)
  const ready = await wait(f, b.id, (b) => !!b.revisions[0]?.preparedAt)
  assert.ok(ready.revisions[0]?.digest, JSON.stringify(ready))
  return ready
}
function proof(
  plan: Parameters<ReleaseExecutor['run']>[0],
  id: string,
  batch: Parameters<ReleaseExecutor['run']>[4],
): BatchTargetValidation {
  assert.ok(batch)
  return {
    batchId: batch.batchId,
    revisionId: batch.revisionId,
    targetId: batch.targetId,
    attemptId: id,
    planDigest: plan.digest,
    checkedAt: batch.consent.issuedAt,
    artifactSha256: plan.snapshot.artifact.sha256 ?? '',
    profileRevision: plan.snapshot.preflight.profileRevision,
    scope: 'artifact_profile_merchant_source',
  }
}
function decision(b: ReleaseBatch) {
  const r = b.revisions[0]
  assert.ok(r?.digest)
  return {
    rid: r.id,
    body: { requestId: randomUUID(), expectedDigest: r.digest, acknowledged: true },
  }
}

test('批次逐项只读准备、刷新去重、一份摘要确认；未知结果不重发且其他渠道继续', async (t) => {
  let active = 0,
    max = 0,
    calls = 0
  const f = await fixture(t, {
    async run(p, id, permit, _report, batch, onAnchor) {
      active++
      max = Math.max(max, active)
      calls++
      assert.equal(p.status, 'frozen')
      assert.equal(p.authorization, null)
      await permit(proof(p, id, batch))
      await delay(5)
      if (p.snapshot.binding.channel === 'meizu') onAnchor?.({ channel: 'meizu', versionId: '200' })
      active--
      return p.snapshot.binding.channel === 'huawei'
        ? 'needs_reconciliation'
        : 'meizu_review_submitted'
    },
    close() {},
  })
  const b = await prepared(f),
    d = decision(b),
    checks = f.calls()
  const centerResponse = await f.api.inject({
    method: 'GET',
    url: '/api/release-center',
    headers: { host: '127.0.0.1' },
  })
  assert.equal(centerResponse.statusCode, 200)
  assert.equal(centerResponse.json().items.length, 1, '批次子计划不重复展示为单渠道计划')
  assert.equal(centerResponse.json().items[0].kind, 'batch')
  assert.equal(f.calls(), checks, '汇总不得重新执行商店预检')
  assert.equal(checks, 3)
  assert.equal((await f.execution.list(...f.args)).length, 0)
  const r = b.revisions[0]
  assert.ok(r)
  const p = (await f.store.list(...f.args)).find((p) => p.id === r.targets[0]?.planId)
  assert.ok(p)
  await assert.rejects(
    f.execution.start(...f.args, p.id, { expectedDigest: p.digest, acknowledged: true }, true),
    /批次子计划/,
  )
  await assert.rejects(
    f.plans.confirm(...f.args, p.id, { expectedDigest: p.digest, acknowledged: true }),
    /批次子计划/,
  )
  await Promise.all([
    f.batches.confirm(...f.args, b.id, d.rid, d.body),
    f.batches.confirm(...f.args, b.id, d.rid, d.body),
  ])
  const result = await wait(f, b.id, (b) => !!b.revisions[0]?.run?.finishedAt)
  assert.equal(max, 1)
  assert.equal(calls, 2)
  assert.deepEqual(
    result.revisions[0]?.targets.map((t) => t.status),
    ['needs_reconciliation', 'succeeded'],
  )
  assert.ok(result.revisions[0]?.targets.every((t) => t.validation))
  await f.batches.confirm(...f.args, b.id, d.rid, d.body)
  assert.equal(calls, 2)
  assert.equal(f.calls(), checks)
  const data = JSON.parse(await readFile(f.file, 'utf8'))
  assert.equal(data.schemaVersion, 15)
  assert.equal(data.attempts.length, 2)
  const meizu = data.attempts.find((a: { code: string }) => a.code === 'meizu_review_submitted')
  assert.deepEqual(meizu.reviewAnchor, { channel: 'meizu', versionId: '200' })
  assert.equal((await new FileReleasePlanStore(f.file).batches(...f.args)).length, 1)
  const newer = await prepared(f),
    nd = decision(newer)
  await assert.rejects(f.batches.confirm(...f.args, newer.id, nd.rid, nd.body), /待核对|确认受理/)
})

test('停止先于写许可则零写入，剩余项停止，单渠道与批次共用槽', async (t) => {
  let enter: () => void = () => undefined,
    release: () => void = () => undefined,
    writes = 0
  const entered = new Promise<void>((r) => (enter = r)),
    gate = new Promise<void>((r) => (release = r))
  const f = await fixture(t, {
    async run(p, id, permit, _report, batch) {
      enter()
      await gate
      await permit(proof(p, id, batch))
      writes++
      return 'draft_saved'
    },
    close() {
      release?.()
    },
  })
  const b = await prepared(f),
    d = decision(b)
  await f.batches.confirm(...f.args, b.id, d.rid, d.body)
  await entered
  const single = await f.plans.freeze(...f.args, f.input)
  await assert.rejects(
    f.execution.start(
      ...f.args,
      single.id,
      { expectedDigest: single.digest, acknowledged: true },
      true,
    ),
    /批次/,
  )
  const running = await f.batches.get(...f.args, b.id),
    run = running.revisions[0]?.run
  assert.ok(run)
  await f.batches.stop(...f.args, b.id, run.id)
  release()
  const stopped = await wait(f, b.id, (b) => !!b.revisions[0]?.run?.finishedAt)
  assert.equal(writes, 0)
  assert.ok(stopped.revisions[0]?.targets.every((t) => t.status === 'stopped'))
  assert.equal((await f.execution.list(...f.args))[0]?.remoteStartedAt, null)
})

test('批次来源、范围、额外字段、版本、失败行与摘要期限均不可绕过', async (t) => {
  const f = await fixture(t)
  const denied = await f.api.inject({
    method: 'POST',
    url: f.batchBase,
    headers: { host: '127.0.0.1' },
    payload: { requestId: randomUUID(), targets: f.targets },
  })
  assert.equal(denied.statusCode, 403)
  await assert.rejects(
    f.batches.create(...f.args, {
      requestId: randomUUID(),
      targets: f.targets,
      workspaceId: 'other',
    }),
  )
  const invalid = structuredClone(f.targets)
  const meizu = invalid[1]
  assert.ok(meizu)
  meizu.releasePolicy = {
    mode: 'scheduled',
    notBefore: new Date(Date.now() + 3600000).toISOString(),
  }
  const b = await f.batches.create(...f.args, { requestId: randomUUID(), targets: invalid })
  await assert.rejects(f.batches.get('local', f.application.id, f.application.id, b.id), /不存在/)
  await f.batches.prepare(...f.args, b.id, {
    requestId: randomUUID(),
    expectedRevision: b.editVersion,
  })
  const failed = await wait(f, b.id, (b) => !!b.revisions[0]?.preparedAt)
  assert.equal(failed.revisions[0]?.digest, null)
  assert.equal(failed.revisions[0]?.targets[1]?.status, 'failed')
  assert.match(failed.revisions[0]?.targets[1]?.message ?? '', /魅族/)
  await assert.rejects(
    f.batches.confirm(...f.args, b.id, failed.revisions[0]?.id ?? '', {
      requestId: randomUUID(),
      expectedDigest: 'a'.repeat(64),
      acknowledged: true,
    }),
  )
  const good = await prepared(f),
    d = decision(good)
  f.advance(300001)
  await assert.rejects(f.batches.confirm(...f.args, good.id, d.rid, d.body), /过期/)
  assert.equal((await f.execution.list(...f.args)).length, 0)
})

test('服务重启分类未完成批次而不续跑，损坏关联拒绝覆盖', async (t) => {
  const f = await fixture(t),
    b = await prepared(f)
  await f.store.execution(async (_p, _a, _q, _apple, batches) => {
    const current = batches.find((v) => v.id === b.id)
    assert.ok(current)
    const r = current.revisions[0]
    assert.ok(r)
    r.run = {
      id: randomUUID(),
      requestId: randomUUID(),
      consent: {
        id: randomUUID(),
        scope: 'local_batch_once',
        digest: r.digest ?? '',
        issuedAt: r.preparedAt ?? r.createdAt,
        expiresAt: new Date(Date.parse(r.preparedAt ?? r.createdAt) + 3600000).toISOString(),
      },
      stoppedAt: null,
      finishedAt: null,
    }
    for (const t of r.targets) t.status = 'queued'
  })
  const recovered = new ReleaseBatchesService(
    f.catalog,
    f.artifacts,
    f.preparations,
    f.plans,
    f.execution,
    f.store,
  )
  const saved = await recovered.get(...f.args, b.id)
  assert.ok(saved.revisions[0]?.run?.finishedAt)
  assert.ok(saved.revisions[0]?.targets.every((t) => t.status === 'interrupted'))
  await recovered.onModuleDestroy()
  assert.equal((await f.execution.list(...f.args)).length, 0)
  const data = JSON.parse(await readFile(f.file, 'utf8'))
  data.batches[0].revisions[0].targets[0].planId = randomUUID()
  await writeFile(f.file, JSON.stringify(data))
  await assert.rejects(new FileReleasePlanStore(f.file).batches(...f.args), /无法读取/)
})

test('旧摘要被编辑或新版本取代后不能再确认，历史快照保持原值', async (t) => {
  const f = await fixture(t),
    b = await prepared(f),
    d = decision(b)
  const targets = f.targets.map((input) => ({ ...input, releaseNotes: '新的更新说明内容' }))
  const changed = await f.batches.edit(...f.args, b.id, {
    expectedRevision: b.editVersion,
    targets,
  })
  await assert.rejects(f.batches.confirm(...f.args, b.id, d.rid, d.body), /取代/)
  await f.batches.prepare(...f.args, b.id, {
    requestId: randomUUID(),
    expectedRevision: changed.editVersion,
  })
  const latest = await wait(f, b.id, (b) => !!b.revisions[1]?.preparedAt)
  assert.equal(latest.revisions[0]?.digest, b.revisions[0]?.digest)
  await assert.rejects(f.batches.confirm(...f.args, b.id, d.rid, d.body), /取代/)
})

test('超过旧五分钟的排队项使用新证明开始写入，批次窗口不续期', async (t) => {
  let calls = 0,
    writes = 0
  const f = await fixture(t, {
    async run(p, id, permit, _report, batch) {
      assert.ok(batch)
      const validation = proof(p, id, batch)
      if (calls++ === 1) {
        f.advance(360000)
        validation.checkedAt = new Date(Date.parse(batch.consent.issuedAt) + 360000).toISOString()
      }
      await permit(validation)
      writes++
      return p.snapshot.binding.channel === 'huawei' ? 'draft_saved' : 'meizu_review_submitted'
    },
    close() {},
  })
  const b = await prepared(f),
    d = decision(b)
  await f.batches.confirm(...f.args, b.id, d.rid, d.body)
  const finished = await wait(f, b.id, (b) => !!b.revisions[0]?.run?.finishedAt)
  assert.equal(writes, 2)
  const run = finished.revisions[0]?.run
  assert.ok(run)
  assert.equal(Date.parse(run.consent.expiresAt) - Date.parse(run.consent.issuedAt), 3600000)
})

test('临执行证明过期、未来或归属错误均不能写入；账号变化和窗口耗尽同样拒绝', async (t) => {
  for (const mode of ['stale', 'future', 'wrong_target', 'profile', 'expired']) {
    await t.test(mode, async (t) => {
      let writes = 0
      const f = await fixture(t, {
        async run(p, id, permit, _report, batch) {
          const validation = proof(p, id, batch)
          if (mode === 'stale') f.advance(300001)
          if (mode === 'future')
            validation.checkedAt = new Date(Date.parse(validation.checkedAt) + 10000).toISOString()
          if (mode === 'wrong_target') validation.targetId = randomUUID()
          if (mode === 'profile')
            for (const item of f.profiles.profiles) item.revision = 'b'.repeat(64)
          if (mode === 'expired') f.advance(3600000)
          await permit(validation)
          writes++
          return 'draft_saved'
        },
        close() {},
      })
      const b = await prepared(f),
        d = decision(b)
      await f.batches.confirm(...f.args, b.id, d.rid, d.body)
      const finished = await wait(f, b.id, (b) => !!b.revisions[0]?.run?.finishedAt)
      assert.equal(writes, 0)
      assert.ok(finished.revisions[0]?.targets.every((t) => !t.validation))
      assert.ok((await f.execution.list(...f.args)).every((a) => a.remoteStartedAt === null))
    })
  }
})

test('写许可先于停止则保留当前未知事实，后续项停止且不创建尝试', async (t) => {
  let entered: () => void = () => undefined,
    release: () => void = () => undefined,
    writes = 0
  const started = new Promise<void>((r) => (entered = r)),
    gate = new Promise<void>((r) => (release = r))
  const f = await fixture(t, {
    async run(p, id, permit, _report, batch) {
      await permit(proof(p, id, batch))
      writes++
      entered()
      await gate
      return 'needs_reconciliation'
    },
    close() {
      release()
    },
  })
  const b = await prepared(f),
    d = decision(b)
  await f.batches.confirm(...f.args, b.id, d.rid, d.body)
  await started
  const running = await f.batches.get(...f.args, b.id),
    run = running.revisions[0]?.run
  assert.ok(run)
  await f.batches.stop(...f.args, b.id, run.id)
  release()
  const saved = await wait(f, b.id, (b) => !!b.revisions[0]?.run?.finishedAt)
  assert.equal(writes, 1)
  assert.deepEqual(
    saved.revisions[0]?.targets.map((t) => t.status),
    ['needs_reconciliation', 'stopped'],
  )
  assert.equal((await f.execution.list(...f.args)).length, 1)
})

test('排队期间指定时间已过，仅失败该目标且不分配新许可', async (t) => {
  let calls = 0,
    writes = 0
  const f = await fixture(t, {
    async run(p, id, permit, _report, batch) {
      await permit(proof(p, id, batch))
      writes++
      if (calls++ === 0) f.advance(120000)
      return 'meizu_review_submitted'
    },
    close() {},
  })
  const huawei = f.targets[0]
  assert.ok(huawei)
  huawei.releasePolicy = {
    mode: 'scheduled',
    notBefore: new Date(Date.now() + 60000).toISOString(),
  }
  f.targets.reverse()
  const b = await prepared(f),
    d = decision(b)
  await f.batches.confirm(...f.args, b.id, d.rid, d.body)
  const saved = await wait(f, b.id, (b) => !!b.revisions[0]?.run?.finishedAt)
  assert.equal(writes, 1)
  assert.deepEqual(
    saved.revisions[0]?.targets.map((t) => t.status),
    ['succeeded', 'failed'],
  )
  assert.equal(saved.revisions[0]?.targets[1]?.attemptId, null)
  const run = saved.revisions[0]?.run
  assert.ok(run)
  const rejected = await f.api.inject({
    method: 'POST',
    url: f.batchBase + '/' + b.id + '/runs/' + run.id + '/stop',
    headers: f.headers,
    payload: [],
  })
  assert.equal(rejected.statusCode, 400)
})

test('批次与 Apple 审核共用一个写入槽，双向确认均不能插队', async (t) => {
  let enter: () => void = () => undefined,
    release: () => void = () => undefined
  const entered = new Promise<void>((r) => (enter = r)),
    gate = new Promise<void>((r) => (release = r))
  const f = await fixture(t, {
    async run(p, id, permit, _report, batch) {
      enter()
      await gate
      await permit(proof(p, id, batch))
      return 'draft_saved'
    },
    close() {
      release()
    },
  })
  const ios = await f.catalog.create('local', f.args[1], {
    name: '隔离 Apple 应用',
    platform: 'ios',
    identifier: 'com.example.ios',
  })
  const binding = await f.catalog.bind('local', f.args[1], ios.id, {
    channel: 'app_store',
    appId: '222222',
    credentialReference: 'synthetic-apple-review',
  })
  f.profiles.profiles.push({
    reference: binding.credentialReference,
    channel: 'app_store',
    configured: true,
    revision: 'a'.repeat(64),
  })
  const n = await appleReviewTestClient(
    join(f.root, 'apple', 'profiles.json'),
    binding,
    ios.identifier,
  )
  let appleEnter: () => void = () => undefined,
    appleRelease: () => void = () => undefined
  const appleEntered = new Promise<void>((r) => (appleEnter = r)),
    appleGate = new Promise<void>((r) => (appleRelease = r))
  const runner = new TestAppleReviewRunner(
    async (job) => {
      if (job.kind !== 'prepare') return { ok: false, code: 'network' }
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
            'a'.repeat(64),
          )
        ).snapshot,
      }
    },
    async (_s, permit) => {
      await permit()
      appleEnter()
      await appleGate
      return { ok: true, value: 'submitted' }
    },
  )
  const service = new AppleReviewService(f.catalog, f.preflights, f.store, runner)
  t.after(async () => {
    appleRelease()
    release()
    await service.onModuleDestroy()
  })
  const review = await service.prepare(f.args[1], ios.id, {
    requestId: randomUUID(),
    bindingId: binding.id,
    buildId: 'B1',
    versionId: 'V1',
    action: 'submit',
    mode: 'manual',
    notes: '审核更新内容',
  })
  const body = { expectedDigest: review.digest, acknowledged: true }
  const b = await prepared(f),
    d = decision(b)
  await f.batches.confirm(...f.args, b.id, d.rid, d.body)
  await entered
  await assert.rejects(service.execute(f.args[1], ios.id, review.id, body), /已有执行/)
  assert.equal(runner.executes, 0)
  const run = (await f.batches.get(...f.args, b.id)).revisions[0]?.run
  assert.ok(run)
  await f.batches.stop(...f.args, b.id, run.id)
  release()
  await wait(f, b.id, (b) => !!b.revisions[0]?.run?.finishedAt)
  const next = await prepared(f),
    nd = decision(next)
  await service.execute(f.args[1], ios.id, review.id, body)
  await appleEntered
  await assert.rejects(f.batches.confirm(...f.args, next.id, nd.rid, nd.body), /已有准备或执行/)
  assert.equal((await f.batches.get(...f.args, next.id)).revisions[0]?.run, null)
  appleRelease()
  for (let i = 0; i < 100; i++) {
    if ((await service.list(f.args[1], ios.id))[0]?.finishedAt) break
    await delay(5)
  }
  assert.ok((await service.list(f.args[1], ios.id))[0]?.finishedAt)
})
