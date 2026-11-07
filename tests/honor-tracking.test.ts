/** @description 荣耀审核单回归；隔离执行记录与合成官方网络验证原单关联、旧版兼容及终态零重查。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setup, confirmed, terminal } from './fixtures/release-plans.ts'
import { FileReleasePlanStore } from '../apps/api/src/release-plan-store.ts'
import { ReleaseObservationService } from '../apps/api/src/release-observation.service.ts'
import { ReleaseObservationStore } from '../apps/api/src/release-observation-store.ts'
import { credentialStore } from '../packages/provider-app-ship/src/credentials.ts'
import { observeHonorRelease } from '../packages/provider-app-ship/src/honor-status.ts'
import {
  isReleaseObservation,
  isReleaseObservationResult,
  type ReleaseObservationResult,
} from '../packages/contracts/src/index.ts'
import { MemoryCredentialSecrets } from './fixtures/credential-intake.ts'
import { honorApp } from './fixtures/store-updates.ts'

test('荣耀原送审审核单随终态持久化，旧schema14读取零回填，已通过单后续只核对上架', async (t) => {
  const f = await setup(
    t,
    'android',
    {
      async run(_plan, _id, permit, _report, _batch, onAnchor) {
        await permit()
        onAnchor?.({ channel: 'honor', versionId: 'audit-300' })
        return 'honor_review_submitted'
      },
      close() {},
    },
    { channel: 'honor' },
  )
  const plan = await confirmed(f)
  await f.execution.start(...f.args, plan.id, { expectedDigest: plan.digest, acknowledged: true })
  await terminal(f)
  const attempt = (await f.store.attempts(...f.args))[0]
  assert.deepEqual(attempt?.reviewAnchor, { channel: 'honor', versionId: 'audit-300' })
  const before = await readFile(f.file, 'utf8')
  const disk = JSON.parse(before)
  assert.equal(disk.schemaVersion, 16)
  const reopened = new FileReleasePlanStore(f.file)
  assert.deepEqual((await reopened.attempts(...f.args))[0]?.reviewAnchor, attempt?.reviewAnchor)
  let now = Date.now(),
    calls = 0
  const outcome: { value: ReleaseObservationResult } = {
    value: { state: 'approved', code: 'observed', rawState: 1 },
  }
  const service = new ReleaseObservationService(
    f.catalog,
    f.store,
    new ReleaseObservationStore(join(f.root, 'observations.json')),
    {
      async run(job) {
        calls++
        assert.deepEqual(job.reviewAnchor, attempt?.reviewAnchor)
        assert.equal(job.knownAudit, calls === 1 ? undefined : 1)
        return outcome.value
      },
      close() {},
    },
    () => now,
  )
  const first = await service.query(f.args[1], f.args[2], plan.id)
  assert.ok(isReleaseObservation(first))
  assert.equal(first.source, 'honor_audit_result')
  now += 10800001
  outcome.value = { state: 'unknown', code: 'publication_unconfirmed', rawState: null }
  const next = await service.query(f.args[1], f.args[2], plan.id)
  assert.ok(isReleaseObservation(next))
  assert.equal(Date.parse(next.nextQueryAt) - Date.parse(next.checkedAt), 10800000)
  assert.equal((await service.list(f.args[1], f.args[2], plan.id))[1]?.checkedAt, first.checkedAt)
  now += 10800001
  outcome.value = { state: 'published', code: 'observed', rawState: null }
  const live = await service.query(f.args[1], f.args[2], plan.id)
  assert.equal((await service.query(f.args[1], f.args[2], plan.id)).id, live.id)
  assert.equal(calls, 3)
  assert.equal(await readFile(f.file, 'utf8'), before)
  // 旧版没有审核单，读取时不补猜；非法把新锚点放入旧版则拒绝覆盖。
  disk.schemaVersion = 14
  await writeFile(f.file, JSON.stringify(disk))
  await assert.rejects(reopened.attempts(...f.args), /无法读取/)
  delete disk.attempts[0].reviewAnchor
  await writeFile(f.file, JSON.stringify(disk))
  assert.equal((await reopened.attempts(...f.args))[0]?.reviewAnchor, undefined)
  assert.equal(await readFile(f.file, 'utf8'), JSON.stringify(disk))
})

test('荣耀按原审核单固定只读POST，拒绝错单且不公开审核意见；终态通过后不再请求该单', async (t) => {
  const f = await setup(t, 'android', undefined, { channel: 'honor' })
  const store = credentialStore(join(f.root, 'profiles.json'), new MemoryCredentialSecrets())
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
    reviewAnchor: { channel: 'honor' as const, versionId: 'audit-300' },
  }
  let auditCalls = 0,
    mismatch = false,
    published = false,
    audit = 0
  const transport: typeof fetch = async (raw, init) => {
    const url = new URL(String(raw))
    if (url.pathname.endsWith('/token'))
      return Response.json({ access_token: 'synthetic-tracking-token' })
    if (url.pathname.endsWith('get-app-id'))
      return Response.json({ code: 0, data: [{ appId: 123456, packageName: job.identifier }] })
    if (url.pathname.endsWith('get-app-detail'))
      return Response.json({
        code: 0,
        data: {
          ...honorApp(job.identifier),
          releaseInfo: published ? { versionName: job.versionName, versionCode: 42 } : {},
        },
      })
    assert.equal(url.pathname, '/openapi/v1/publish/get-audit-result')
    assert.equal(init?.method, 'POST')
    assert.deepEqual(JSON.parse(String(init?.body)), {
      appId: [{ appId: 123456, releaseId: 'audit-300' }],
    })
    auditCalls++
    return Response.json({
      code: 0,
      data: [
        {
          appId: 123456,
          releaseId: mismatch ? 'other' : 'audit-300',
          auditResult: audit,
          auditMessage: 'private-review-sentinel',
          auditAttachment: ['https://invalid.test/private'],
        },
      ],
    })
  }
  for (const [raw, state] of [
    [0, 'in_review'],
    [1, 'approved'],
    [2, 'rejected'],
    [3, 'unknown'],
  ] as const) {
    audit = raw
    const result = await observeHonorRelease(store, job, transport)
    assert.equal(result.state, state)
    assert.ok(isReleaseObservationResult(result))
    assert.equal(JSON.stringify(result).includes('private'), false)
  }
  mismatch = true
  assert.equal((await observeHonorRelease(store, job, transport)).code, 'invalid_response')
  const count = auditCalls
  assert.equal(
    (await observeHonorRelease(store, { ...job, knownAudit: 1 }, transport)).code,
    'publication_unconfirmed',
  )
  published = true
  assert.equal(
    (await observeHonorRelease(store, { ...job, knownAudit: 1 }, transport)).state,
    'published',
  )
  assert.equal(auditCalls, count)
})
