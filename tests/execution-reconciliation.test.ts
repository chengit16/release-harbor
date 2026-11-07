/** @description 执行诊断及人工核对集成测试；使用合成端口，核对永不触发商店操作或重置旧授权。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { setup, confirmed, terminal } from './fixtures/release-plans.ts'
import { isReleaseAttempt, type ExecutionDiagnostic } from '../packages/contracts/src/index.ts'
import { FileReleasePlanStore } from '../apps/api/src/release-plan-store.ts'
import { attemptBlocksTarget } from '../apps/api/src/release-reconciliation.ts'

async function pending(t: test.TestContext) {
  let runs = 0
  const f = await setup(t, 'android', {
    async run(_plan, _id, permit) {
      runs++
      await permit()
      return 'needs_reconciliation'
    },
    close() {},
  })
  const p = await confirmed(f)
  await f.execution.start(...f.args, p.id, { expectedDigest: p.digest, acknowledged: true })
  const a = await terminal(f)
  const body = {
    expectedDigest: p.digest,
    versionName: '1.2.3',
    buildNumber: '42',
    decision: 'no_draft',
    acknowledged: true,
  }
  const endpoint = f.base.replace(/release-plans$/, 'release-attempts') + '/' + a.id + '/reconcile'
  return { ...f, p, a, body, endpoint, runs: () => runs }
}

test('许可后保留安全异常原因但始终待核对，磁盘和公开接口不泄露正文，也不重新派发', async (t) => {
  const reasons: ExecutionDiagnostic[] = [
    'upload_timeout',
    'upload_network_error',
    'upload_aborted',
    'upload_http_error',
    'upload_invalid_response',
    'upload_rejected',
    'runner_interrupted',
    'merchant_target',
  ]
  for (const reason of reasons) {
    let runs = 0
    const f = await setup(
      t,
      'android',
      {
        async run(_p, _id, permit, report) {
          runs++
          await permit()
          report?.(reason)
          return 'needs_reconciliation'
        },
        close() {},
      },
      { channel: 'xiaomi' },
    )
    const p = await confirmed(f)
    await f.execution.start(...f.args, p.id, { expectedDigest: p.digest, acknowledged: true })
    const a = await terminal(f)
    assert.equal(a.status, 'needs_reconciliation')
    assert.ok(a.remoteStartedAt)
    assert.equal(a.diagnostic, reason === 'merchant_target' ? 'remote_unknown' : reason)
    assert.ok(isReleaseAttempt(a))
    assert.deepEqual((await new FileReleasePlanStore(f.file).attempts(...f.args))[0], a)
    const response = await f.api.inject({
      method: 'GET',
      url: f.base.replace('release-plans', 'release-attempts'),
      headers: { host: '127.0.0.1' },
    })
    assert.equal(response.json().items[0].diagnostic, a.diagnostic)
    const next = await f.plans.freeze(...f.args, { ...f.input, requestId: randomUUID() })
    await assert.rejects(
      f.execution.start(...f.args, next.id, {
        expectedDigest: next.digest,
        acknowledged: true,
      }),
      /待核对/,
    )
    assert.equal(runs, 1)
  }
})

test('人工核对保留原始事实，重复同结论去重、相反结论冲突，刷新和重启不派发', async (t) => {
  const f = await pending(t)
  const { diagnostic, ...original } = f.a
  assert.equal(diagnostic, 'remote_unknown')
  const result = await f.api.inject({
    method: 'POST',
    url: f.endpoint,
    headers: f.headers,
    payload: f.body,
  })
  assert.equal(result.statusCode, 201, result.body)
  const a = result.json().attempt
  assert.ok(isReleaseAttempt(a))
  assert.ok(a.reconciliation)
  assert.equal(a.reconciliation.decision, 'no_draft')
  assert.equal(
    isReleaseAttempt({ ...a, reconciliation: { ...a.reconciliation, decision: ['no_draft'] } }),
    false,
  )
  const { reconciliation, diagnostic: code, ...unchanged } = a
  assert.deepEqual(unchanged, original)
  assert.equal(code, diagnostic)
  f.advance(1000)
  const repeatedResults = await Promise.all(
    Array.from({ length: 4 }, () => f.execution.reconcile(...f.args, f.a.id, f.body)),
  )
  repeatedResults.forEach((value) => assert.deepEqual(value, a))
  await assert.rejects(
    f.execution.reconcile(...f.args, f.a.id, { ...f.body, decision: 'draft_present' }),
    /另一核对结论/,
  )
  assert.deepEqual((await new FileReleasePlanStore(f.file).attempts(...f.args))[0], a)
  assert.equal(f.runs(), 1)
  const repeated = await f.execution.start(...f.args, f.p.id, {
    expectedDigest: f.p.digest,
    acknowledged: true,
  })
  assert.equal(repeated.id, f.a.id)
  assert.equal(f.runs(), 1, '旧计划不能因核对重新派发')
  const next = await f.plans.freeze(...f.args, { ...f.input, requestId: randomUUID() })
  await f.plans.confirm(...f.args, next.id, { expectedDigest: next.digest, acknowledged: true })
  await f.execution.start(...f.args, next.id, { expectedDigest: next.digest, acknowledged: true })
  await terminal(f)
  assert.equal(f.runs(), 2, '未保存结论只允许新计划显式执行')
})

test('确认已有草稿后保护相同安装包与版本，新版本仍需新授权', async (t) => {
  const f = await pending(t)
  const checked = await f.execution.reconcile(...f.args, f.a.id, {
    ...f.body,
    decision: 'draft_present',
  })
  assert.equal(attemptBlocksTarget(checked, f.p, f.p), true)
  const different = structuredClone(f.p)
  different.snapshot.artifact.sha256 = 'b'.repeat(64)
  assert.equal(attemptBlocksTarget(checked, f.p, different), true, '重新打包仍是同一版本')
  assert.ok(different.snapshot.artifact.identity)
  different.snapshot.artifact.identity.buildNumber = '43'
  assert.equal(attemptBlocksTarget(checked, f.p, different), false)
  const next = await f.plans.freeze(...f.args, { ...f.input, requestId: randomUUID() })
  await f.plans.confirm(...f.args, next.id, { expectedDigest: next.digest, acknowledged: true })
  await assert.rejects(
    f.execution.start(...f.args, next.id, { expectedDigest: next.digest, acknowledged: true }),
    /已确认受理/,
  )
  assert.equal(f.runs(), 1)
})

test('核对拒绝无来源、跨归属、陈旧摘要、版本错配、未知字段和仍不确定，不解除阻塞', async (t) => {
  const f = await pending(t)
  for (const payload of [
    { ...f.body, acknowledged: false },
    { ...f.body, decision: 'uncertain' },
    { ...f.body, token: '不允许材料' },
    { ...f.body, expectedDigest: 'b'.repeat(64) },
    { ...f.body, buildNumber: '99' },
    { ...f.body, versionName: '0.0.0' },
  ]) {
    const response = await f.api.inject({
      method: 'POST',
      url: f.endpoint,
      headers: f.headers,
      payload,
    })
    assert.ok(response.statusCode === 400 || response.statusCode === 409)
  }
  assert.equal(
    (
      await f.api.inject({
        method: 'POST',
        url: f.endpoint,
        headers: { host: '127.0.0.1' },
        payload: f.body,
      })
    ).statusCode,
    403,
  )
  await assert.rejects(
    f.execution.reconcile('other', f.args[1], f.args[2], f.a.id, f.body),
    /不存在/,
  )
  assert.equal((await f.execution.list(...f.args))[0]?.reconciliation, undefined)
  assert.equal(attemptBlocksTarget(f.a, f.p, f.p), true)
  assert.equal(f.runs(), 1)
})

test('固定诊断保存且成功、执行前失败、进行中均不可核对；旧版本无原因不虚构', async (t) => {
  const f = await setup(t, 'android', {
    async run(_p, _id, _permit, report) {
      report?.('artifact_invalid')
      return 'verification_failed'
    },
    close() {},
  })
  const p = await confirmed(f)
  await f.execution.start(...f.args, p.id, { expectedDigest: p.digest, acknowledged: true })
  const a = await terminal(f)
  assert.equal(a.diagnostic, 'artifact_invalid')
  const body = {
    expectedDigest: p.digest,
    versionName: '1.2.3',
    buildNumber: '42',
    decision: 'no_draft',
    acknowledged: true,
  }
  await assert.rejects(f.execution.reconcile(...f.args, a.id, body), /仅已结束的待核对/)
  const legacy = structuredClone(a)
  delete legacy.diagnostic
  await writeFile(f.file, JSON.stringify({ schemaVersion: 2, plans: [p], attempts: [legacy] }))
  assert.equal(
    (await new FileReleasePlanStore(f.file).attempts(...f.args))[0]?.diagnostic,
    undefined,
  )
  const before = await readFile(f.file, 'utf8')
  await writeFile(f.file, before.replace('verification_failed', 'secret_not_allowed'))
  await assert.rejects(f.execution.list(...f.args), /无法读取/)
})

test('进行中和系统成功回执不能被人工重标，不能借核对触发第二次执行', async (t) => {
  let release: (() => void) | undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const f = await setup(t, 'android', {
    async run(_p, _id, permit) {
      await gate
      await permit()
      return 'draft_saved'
    },
    close() {
      release?.()
    },
  })
  const p = await confirmed(f)
  const a = await f.execution.start(...f.args, p.id, {
    expectedDigest: p.digest,
    acknowledged: true,
  })
  const body = {
    expectedDigest: p.digest,
    versionName: '1.2.3',
    buildNumber: '42',
    decision: 'no_draft',
    acknowledged: true,
  }
  await assert.rejects(f.execution.reconcile(...f.args, a.id, body), /仅已结束的待核对/)
  release?.()
  assert.equal((await terminal(f)).status, 'succeeded')
  await assert.rejects(f.execution.reconcile(...f.args, a.id, body), /仅已结束的待核对/)
})
