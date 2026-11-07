/** @description 两家新渠道的公开结构及原子准备／确认恢复，所有材料均为隔离合成数据。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { FileReleasePlanStore } from '../apps/api/src/release-plan-store.ts'
import { setup } from './fixtures/release-plans.ts'
import { fixture, network } from './fixtures/tencent-harmony-execution.ts'
import { tencentDetails, harmonyDetails } from './fixtures/tencent-harmony.ts'
import { MemoryCredentialSecrets } from './fixtures/credential-intake.ts'
import {
  checkMerchant,
  localCredentialRepository,
} from '../packages/provider-app-ship/src/index.ts'
import { isFinalUploadUrl } from '../packages/provider-app-ship/src/tencent-harmony-client.ts'
import { validateReleasePlanInput } from '../packages/domain/src/index.ts'
import {
  isReleasePlanSnapshot,
  isReleaseAttempt,
  isPreflightRecord,
  isTencentUpdateDetails,
  isHarmonyUpdateDetails,
} from '../packages/contracts/src/index.ts'
import { isPreflightOutcome } from '../packages/runner-local/src/preflight-protocol.ts'
test('应用宝／鸿蒙公开结构、平台、正式 APP、来源与私有协议边界', async (t) => {
  for (const channel of ['tencent', 'harmony'] as const) {
    const f = await fixture(t, channel),
      n = network(f),
      check = await checkMerchant(
        {
          channel,
          reference: f.binding.credentialReference,
          identifier: f.application.identifier,
          appId: f.binding.appId,
        },
        f.credentials,
        n.transport,
      )
    assert.equal(check.code, 'verified')
    assert.equal(check.authentication, 'passed')
    assert.equal(n.writes, 0)
    const serialized = JSON.stringify(check)
    assert.ok(!serialized.includes('DO-NOT-PROJECT'))
    assert.ok(!serialized.includes('STALE-SERIAL'))
    const source = channel === 'tencent' ? check.tencent : check.harmony
    assert.deepEqual(source, channel === 'tencent' ? tencentDetails : harmonyDetails)
    assert.ok(isPreflightOutcome({ ...check, artifact: 'passed' }))
    assert.ok(isReleasePlanSnapshot(f.plan.snapshot))
    assert.ok(isPreflightRecord(f.plan.snapshot.preflight))
    assert.equal(isPreflightOutcome({ ...check, artifact: 'passed', token: 'secret' }), false)
    assert.equal(
      isReleasePlanSnapshot({
        ...f.plan.snapshot,
        binding: {
          ...f.plan.snapshot.binding,
          channel: channel === 'harmony' ? 'huawei' : 'harmony',
        },
      }),
      false,
    )
    const repo = localCredentialRepository(f.vault, new MemoryCredentialSecrets())
    // SDK 材料必须来自注入内存安全库；目录读取不触发真实 Keychain。
    assert.equal((await repo.catalog()).profiles[0]?.channel, channel)
  }
  assert.equal(isTencentUpdateDetails({ ...tencentDetails, loginAccount: 'private' }), false)
  assert.equal(isHarmonyUpdateDetails({ ...harmonyDetails, token: 'private' }), false)
  assert.equal(isFinalUploadUrl('https://evil.example/upload', 'harmony'), false)
  assert.equal(isFinalUploadUrl('http://127.0.0.1/upload', 'tencent'), false)
  assert.throws(() =>
    validateReleasePlanInput({
      requestId: randomUUID(),
      preflightId: randomUUID(),
      action: 'harmony_submit_review',
      releaseNotes: 'x',
      releasePolicy: { mode: 'manual' },
    }),
  )
})

test('两家准备无需手动预检，确认原子消费一次；重启恢复十三版含 Apple 审核记录且不重放', async (t) => {
  for (const channel of ['tencent', 'harmony'] as const) {
    let calls = 0
    const f = await setup(
      t,
      channel === 'harmony' ? 'harmony' : 'android',
      {
        async run(_p, _id, permit) {
          calls++
          await permit()
          return channel === 'tencent' ? 'tencent_review_submitted' : 'harmony_review_submitted'
        },
        close() {},
      },
      { channel },
    )
    const preparation = await f.preparations.start(...f.args, {
      requestId: randomUUID(),
      bindingId: f.binding.id,
      artifactId: f.artifact.id,
      expectedBindingRevision: 1,
      expectedArtifactSha256: f.artifact.sha256,
      releasePolicy: { mode: 'after_approval' },
      releaseNotes: '正式版本更新说明',
    })
    let ready = preparation
    for (let n = 0; n < 100; n++) {
      const observed = (await f.preparations.list(...f.args))[0]
      assert.ok(observed)
      ready = observed
      if (ready.status !== 'checking') break
      await delay(10)
    }
    assert.equal(ready.status, 'ready')
    assert.ok(ready.planId)
    const view = (await f.plans.list(...f.args)).find((v) => v.plan.id === ready.planId)
    assert.ok(view)
    assert.equal(view.plan.authorization, null)
    assert.equal(calls, 0)
    const request = {
      method: 'POST' as const,
      url: f.base + '/' + ready.planId + '/confirm-and-execute',
      headers: f.headers,
      payload: { expectedDigest: view.plan.digest, acknowledged: true },
    }
    const results = await Promise.all([f.api.inject(request), f.api.inject(request)])
    assert.ok(results.every((r) => r.statusCode === 201))
    assert.equal(results[0].json().attempt.id, results[1].json().attempt.id)
    for (let n = 0; n < 100; n++) {
      const a = (await f.execution.list(...f.args))[0]
      if (a?.finishedAt) {
        assert.equal(a.status, 'succeeded')
        assert.ok(isReleaseAttempt(a))
        break
      }
      await delay(10)
    }
    assert.equal(calls, 1)
    const disk = JSON.parse(await readFile(f.file, 'utf8'))
    assert.equal(disk.schemaVersion, 16)
    assert.ok(Array.isArray(disk.appleReviews))
    const restored = new FileReleasePlanStore(f.file)
    assert.deepEqual(await restored.attempts(...f.args), await f.execution.list(...f.args))
    assert.equal(calls, 1)
  }
})
