/** @description 重新打包不能绕过已受理版本保护；单渠道和批次共用规则，仅使用隔离产物和替身执行器。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import type { ReleaseAttempt } from '../packages/contracts/src/index.ts'
import { attemptBlocksTarget } from '../apps/api/src/release-reconciliation.ts'
import { assertBatchTargetUnblocked } from '../apps/api/src/release-batch-dispatch.ts'
import { setup, confirmed, terminal } from './fixtures/release-plans.ts'

test('各渠道按官方版本身份阻止不同字节的重复提交，仍允许独立目标和新版本', async (t) => {
  for (const channel of [
    'huawei',
    'xiaomi',
    'oppo',
    'vivo',
    'meizu',
    'honor',
    'tencent',
    'harmony',
    'app_store',
  ] as const) {
    // 1. 各渠道复用隔离准备路径，已有受理记录仅由合成事实构造。
    const platform = channel === 'app_store' ? 'ios' : channel === 'harmony' ? 'harmony' : 'android'
    const f = await setup(t, platform, undefined, { channel })
    const previous = await confirmed(f)
    const attempt: ReleaseAttempt = {
      id: randomUUID(),
      planId: previous.id,
      planDigest: previous.digest,
      authorizationId: previous.authorization?.id ?? '',
      status: 'succeeded',
      code: 'draft_saved',
      createdAt: previous.createdAt,
      remoteStartedAt: previous.createdAt,
      finishedAt: previous.createdAt,
    }
    const next = structuredClone(previous)
    next.snapshot.artifact.sha256 = 'b'.repeat(64)
    const identity = next.snapshot.artifact.identity
    assert.ok(identity)
    identity.sha256 = next.snapshot.artifact.sha256
    // 2. 相同版本即使文件摘要变化也受保护，独立商店目标不被连带阻塞。
    assert.equal(attemptBlocksTarget(attempt, previous, next), true, channel)
    assert.throws(() => assertBatchTargetUnblocked(next, [previous], [attempt]), /受理/)
    next.snapshot.binding.appId = 'another-target'
    assert.equal(attemptBlocksTarget(attempt, previous, next), false, channel)
    next.snapshot.binding.appId = previous.snapshot.binding.appId
    if (channel === 'app_store') {
      identity.versionName = '2.0.0'
      assert.equal(attemptBlocksTarget(attempt, previous, next), false, '不同市场版本可复用构建号')
      identity.versionName = previous.snapshot.artifact.identity?.versionName ?? ''
    }
    // 3. Android／鸿蒙按构建号，魅族按版本名，Apple 按版本名与构建号组合区分新版本。
    if (channel !== 'meizu' && channel !== 'app_store') {
      identity.versionName = '不同显示名称'
      identity.buildNumber = '00042'
      assert.equal(attemptBlocksTarget(attempt, previous, next), true, channel)
    }
    if (channel === 'meizu') identity.versionName = '2.0.0'
    else identity.buildNumber = '43'
    assert.equal(attemptBlocksTarget(attempt, previous, next), false, channel)
    next.snapshot.artifact.sha256 = previous.snapshot.artifact.sha256
    assert.equal(attemptBlocksTarget(attempt, previous, next), true, '相同字节也不能改名重发')
  }
})

test('人工确认已存在保留版本保护，未知仍阻塞整个目标，确认不存在与写前失败不阻塞', async (t) => {
  const f = await setup(t)
  const previous = await confirmed(f)
  const next = structuredClone(previous)
  next.snapshot.artifact.sha256 = 'b'.repeat(64)
  const attempt: ReleaseAttempt = {
    id: randomUUID(),
    planId: previous.id,
    planDigest: previous.digest,
    authorizationId: previous.authorization?.id ?? '',
    status: 'needs_reconciliation',
    code: 'needs_reconciliation',
    createdAt: previous.createdAt,
    remoteStartedAt: previous.createdAt,
    finishedAt: previous.createdAt,
  }
  assert.equal(attemptBlocksTarget(attempt, previous, next), true)
  attempt.reconciliation = {
    source: 'local_user',
    checkedAt: previous.createdAt,
    decision: 'build_present',
  }
  assert.equal(attemptBlocksTarget(attempt, previous, next), true)
  assert.ok(next.snapshot.artifact.identity)
  next.snapshot.artifact.identity.buildNumber = '43'
  assert.equal(attemptBlocksTarget(attempt, previous, next), false)
  delete attempt.reconciliation
  assert.equal(attemptBlocksTarget(attempt, previous, next), true)
  attempt.reconciliation = {
    source: 'local_user',
    checkedAt: previous.createdAt,
    decision: 'no_build',
  }
  assert.equal(attemptBlocksTarget(attempt, previous, next), false)
  attempt.status = 'failed'
  assert.equal(attemptBlocksTarget(attempt, previous, next), false)
})

test('同版本重新接入不同字节并准备新摘要，单渠道与批次确认均拒绝且不消费', async (t) => {
  for (const platform of ['ios', 'android'] as const) {
    await t.test(platform, async (t) => {
      // 1. 先形成真实控制面成功回执，后续新计划必须保留其消费事实。
      let runs = 0
      const f = await setup(t, platform, {
        async run(_plan, _id, permit) {
          runs++
          await permit()
          return platform === 'ios' ? 'build_uploaded' : 'draft_saved'
        },
        close() {},
      })
      const p = await confirmed(f)
      await f.execution.start(...f.args, p.id, { expectedDigest: p.digest, acknowledged: true })
      assert.equal((await terminal(f)).status, 'succeeded')
      // 2. 字节、产物 ID、预检与摘要均真实更新，检查器仍解析出相同版本／构建。
      const content = Buffer.from('repackaged-synthetic-bytes')
      const received = await f.artifacts.receive(
        ...f.args,
        `repackaged.${platform === 'ios' ? 'ipa' : 'apk'}`,
        content.length,
        Readable.from(content),
      )
      for (let i = 0; i < 100; i++) {
        if ((await f.artifacts.get(...f.args, received.id)).status === 'ready') break
        await delay(5)
      }
      const check = await f.preflights.start(...f.args, {
        bindingId: f.binding.id,
        artifactId: received.id,
        expectedBindingRevision: 1,
        expectedProfileRevision: 'a'.repeat(64),
      })
      for (let i = 0; i < 100; i++) {
        if ((await f.preflights.list(...f.args)).some((v) => v.record.id === check.id && v.current))
          break
        await delay(5)
      }
      const next = await f.plans.freeze(...f.args, {
        ...f.input,
        requestId: randomUUID(),
        preflightId: check.id,
      })
      assert.notEqual(next.snapshot.artifact.sha256, p.snapshot.artifact.sha256)
      assert.notEqual(next.digest, p.digest)
      // 3. 单渠道及新批次均在授权消费前拒绝，不能让后续 worker 或商店承担防重。
      await assert.rejects(
        f.execution.start(
          ...f.args,
          next.id,
          { expectedDigest: next.digest, acknowledged: true },
          true,
        ),
        /受理/,
      )
      assert.equal(
        (await f.store.list(...f.args)).find((v) => v.id === next.id)?.authorization,
        null,
      )
      if (platform === 'android') {
        // 新建批次也不能改变商店版本；确认失败不保存批次授权或创建第二次尝试。
        const batch = await f.batches.create(...f.args, {
          requestId: randomUUID(),
          targets: [
            {
              bindingId: f.binding.id,
              artifactId: received.id,
              expectedBindingRevision: f.binding.revision,
              expectedArtifactSha256: next.snapshot.artifact.sha256,
              releaseNotes: f.input.releaseNotes,
              releasePolicy: f.input.releasePolicy,
            },
          ],
        })
        await f.batches.prepare(...f.args, batch.id, {
          requestId: randomUUID(),
          expectedRevision: batch.editVersion,
        })
        let prepared = await f.batches.get(...f.args, batch.id)
        for (let i = 0; i < 100 && !prepared.revisions[0]?.preparedAt; i++) {
          await delay(5)
          prepared = await f.batches.get(...f.args, batch.id)
        }
        const revision = prepared.revisions[0]
        assert.ok(revision?.digest)
        await assert.rejects(
          f.batches.confirm(...f.args, batch.id, revision.id, {
            requestId: randomUUID(),
            expectedDigest: revision.digest,
            acknowledged: true,
          }),
          /受理/,
        )
        assert.equal((await f.batches.get(...f.args, batch.id)).revisions[0]?.run, null)
      }
      assert.equal((await f.execution.list(...f.args)).length, 1)
      assert.equal(runs, 1)
    })
  }
})
