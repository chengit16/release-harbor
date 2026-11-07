/** @description 华为 Android 正式送审的授权、官方字段、等待时序与恢复边界；仅合成材料和网络。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { huaweiFixture, huaweiNetwork } from './fixtures/huawei-updates.ts'
import { setup, terminal } from './fixtures/release-plans.ts'
import { submitHuaweiUpdate } from '../packages/provider-app-ship/src/huawei-updates.ts'
import {
  isReleasePlanSnapshot,
  isBatchTargetInput,
  isPreflightRecord,
} from '../packages/contracts/src/index.ts'
import { isPreflightOutcome } from '../packages/runner-local/src/preflight-protocol.ts'
import { FileReleasePlanStore } from '../apps/api/src/release-plan-store.ts'
import * as providers from '../packages/provider-app-ship/src/index.ts'
import { runRelease } from '../packages/runner-local/src/run-release.ts'
import { syntheticApk } from './fixtures/apk.ts'
import { resign } from './fixtures/tencent-harmony-execution.ts'
import { huaweiUpdateSource } from '../packages/provider-app-ship/src/huawei-material.ts'
import { huaweiSourceResponse } from './fixtures/huawei-updates.ts'

test('官方来源错配、非在架和默认语言缺项均在只读阶段拒绝，不传播私人正文', async () => {
  for (const change of ['target', 'draft', 'language', 'country'] as const) {
    const transport: typeof fetch = async (input) =>
      new Response(
        JSON.stringify(
          String(input).includes('/appid-list')
            ? { ret: { code: 0 }, appids: [{ value: change === 'target' ? '654321' : '123456' }] }
            : {
                ...huaweiSourceResponse,
                appInfo: {
                  ...huaweiSourceResponse.appInfo,
                  releaseState: change === 'draft' ? 7 : 0,
                  publishCountry: change === 'country' ? '' : 'CN',
                },
                languages: change === 'language' ? [] : huaweiSourceResponse.languages,
              },
        ),
      )
    await assert.rejects(
      huaweiUpdateSource(
        { clientId: 'synthetic', token: 'synthetic' },
        'com.example.android',
        '123456',
        transport,
      ),
      (error) => error instanceof Error && !error.message.includes('SENSITIVE'),
    )
  }
})

test('可信 worker 通过真实 APK 副本检查后只许可一次，损坏文件不能进入 provider', async (t) => {
  const f = await huaweiFixture(t),
    bytes = await syntheticApk(f.root)
  assert.ok(bytes, '本机需要 aapt2')
  await writeFile(f.file, bytes)
  const identity = await providers.inspectLocalArtifact(f.file)
  Object.assign(f.plan.snapshot.artifact, {
    identity,
    sha256: identity.sha256,
    sizeBytes: bytes.length,
    expectedSizeBytes: bytes.length,
  })
  f.plan.snapshot.preflight.artifactSha256 = identity.sha256
  resign(f.plan)
  const n = huaweiNetwork(f)
  const provider = {
    ...providers,
    credentialStore: () => f.credentials,
    submitHuaweiUpdate: (...args: Parameters<typeof submitHuaweiUpdate>) =>
      submitHuaweiUpdate(args[0], args[1], args[2], args[3], args[4], n),
  }
  const task = {
    schemaVersion: 1 as const,
    nonce: 'a'.repeat(32),
    attemptId: randomUUID(),
    plan: f.plan,
    vaultPath: f.vault,
    storageRoot: await realpath(join(f.root, 'artifacts')),
  }
  let permits = 0
  assert.equal(
    await runRelease(
      task,
      async () => {
        permits++
        n.permit()
      },
      undefined,
      provider,
    ),
    'huawei_review_submitted',
  )
  assert.equal(permits, 1)
  const count = n.calls.length
  await writeFile(f.file, 'damaged')
  assert.equal(
    await runRelease(
      task,
      async () => {
        permits++
      },
      undefined,
      provider,
    ),
    'verification_failed',
  )
  assert.equal(permits, 1)
  assert.equal(n.calls.length, count)
})

test('华为 v2 按许可、上传、文件绑定、默认语言、两分钟解析、送审及同构建回读执行', async (t) => {
  const f = await huaweiFixture(t)
  assert.ok(isReleasePlanSnapshot(f.plan.snapshot))
  for (const mode of ['after_approval', 'scheduled'] as const) {
    f.plan.snapshot.releasePolicy =
      mode === 'scheduled'
        ? { mode, notBefore: new Date(Date.now() + 3600000).toISOString() }
        : { mode }
    const n = huaweiNetwork(f)
    assert.equal(
      await submitHuaweiUpdate(f.plan, f.file, f.vault, async () => n.permit(), f.credentials, n),
      'huawei_review_submitted',
    )
    assert.deepEqual(
      n.calls.filter((c) => c.method !== 'GET').map((c) => [c.method, c.path]),
      [
        ['POST', '/api/oauth2/v1/token'],
        ['PUT', '/app/synthetic.apk'],
        ['PUT', '/api/publish/v2/app-file-info'],
        ['PUT', '/api/publish/v2/app-language-info'],
        ['POST', '/api/publish/v2/app-submit'],
      ],
    )
    assert.deepEqual(n.calls.find((c) => c.path.endsWith('/app-file-info'))?.body, {
      fileType: 5,
      files: [{ fileName: 'payload.apk', fileDestUrl: 'app/synthetic.apk' }],
    })
    assert.deepEqual(n.calls.find((c) => c.path.endsWith('/app-language-info'))?.body, {
      lang: 'zh-CN',
      newFeatures: f.plan.snapshot.releaseNotes,
    })
    const submit = n.calls.find((c) => c.path.endsWith('/app-submit'))
    assert.equal(submit?.query.get('releaseType'), '1')
    assert.equal(submit?.query.get('appId'), f.binding.appId)
    assert.equal(submit?.query.has('releaseTime'), mode === 'scheduled')
    if (mode === 'scheduled') assert.match(submit?.query.get('releaseTime') ?? '', /\+0000$/)
  }
})

test('来源、许可或真实文件变化在首次写入前拒绝；后续步骤不重放', async (t) => {
  const f = await huaweiFixture(t)
  for (const failure of ['source', 'permit', 'artifact'] as const) {
    const n = huaweiNetwork(f, { sourceChanged: failure === 'source' })
    if (failure === 'artifact') await writeFile(f.file, 'changed')
    assert.equal(
      await submitHuaweiUpdate(
        f.plan,
        f.file,
        f.vault,
        async () => {
          if (failure === 'permit') throw new Error('许可拒绝')
          n.permit()
        },
        f.credentials,
        n,
      ),
      'verification_failed',
    )
    assert.equal(n.calls.filter((c) => !c.path.endsWith('/token') && c.method !== 'GET').length, 0)
    assert.equal(
      n.calls.some((c) => c.path.endsWith('/for-obs')),
      false,
    )
  }
})

test('上传地址、签名头、解析版本和说明、回执错配及提交超时一律待核对且不重试', async (t) => {
  const f = await huaweiFixture(t)
  for (const options of [
    { badUrl: true },
    { badHeaders: true },
    { wrongVersion: true },
    { wrongNotes: true },
    { submitLost: true },
    { wrongReceipt: true },
    { parsedState: 5 },
  ]) {
    const n = huaweiNetwork(f, options),
      diagnostics: string[] = []
    assert.equal(
      await submitHuaweiUpdate(f.plan, f.file, f.vault, async () => n.permit(), f.credentials, {
        ...n,
        report: (c) => diagnostics.push(c),
      }),
      'needs_reconciliation',
    )
    assert.ok(n.calls.filter((c) => c.path.endsWith('/app-submit')).length <= 1)
    if (!('submitLost' in options || 'wrongReceipt' in options))
      assert.equal(
        n.calls.some((c) => c.path.endsWith('/app-submit')),
        false,
      )
    assert.equal(JSON.stringify(diagnostics).includes('SENSITIVE'), false)
  }
})

test('等待期间账号或时间变化停止送审，保留一次上传事实', async (t) => {
  for (const kind of ['profile', 'time'] as const) {
    const f = await huaweiFixture(t),
      n = huaweiNetwork(f)
    assert.equal(
      await submitHuaweiUpdate(f.plan, f.file, f.vault, async () => n.permit(), f.credentials, {
        ...n,
        wait: async (ms) => {
          await n.wait(ms)
          if (kind === 'profile') await writeFile(f.vault, '{}')
          else
            f.plan.snapshot.releasePolicy = {
              mode: 'scheduled',
              notBefore: new Date(Date.now() - 1000).toISOString(),
            }
        },
      }),
      'needs_reconciliation',
    )
    assert.equal(
      n.calls.some((c) => c.path.endsWith('/app-submit')),
      false,
    )
    assert.equal(n.calls.filter((c) => c.path === '/app/synthetic.apk').length, 1)
  }
})

test('正式送审准备冻结来源与策略、一次确认去重；旧草稿和批次动作保持原意', async (t) => {
  const details = (await huaweiFixture(t)).plan.snapshot.huawei
  let updateChecks = 0,
    runs = 0
  const f = await setup(
    t,
    'android',
    {
      async run(_p, _id, permit) {
        runs++
        await permit()
        return 'huawei_review_submitted'
      },
      close() {},
    },
    {
      async check(task) {
        if (task?.huaweiUpdate) updateChecks++
        return {
          code: 'verified',
          artifact: 'passed',
          authentication: 'passed',
          target: 'passed',
          ...(task?.huaweiUpdate ? { huawei: details } : {}),
        }
      },
    },
  )
  const body = {
    requestId: randomUUID(),
    bindingId: f.binding.id,
    artifactId: f.artifact.id,
    expectedBindingRevision: 1,
    expectedArtifactSha256: f.artifact.sha256,
    releaseNotes: '华为正式更新',
    releasePolicy: { mode: 'after_approval' },
    huaweiAction: 'submit_review',
  }
  for (const bad of [
    { ...body, releaseNotes: '字'.repeat(1001) },
    { ...body, releasePolicy: undefined },
  ])
    await assert.rejects(f.preparations.start(...f.args, bad))
  await f.preparations.start(...f.args, body)
  for (let i = 0; i < 100 && (await f.preparations.list(...f.args))[0]?.status === 'checking'; i++)
    await delay(10)
  const p = (await f.store.list(...f.args))[0]
  assert.ok(p)
  assert.equal(p.snapshot.action, 'huawei_submit_review')
  assert.deepEqual(p.snapshot.huawei, details)
  assert.equal(p.authorization, null)
  assert.equal(updateChecks, 1)
  await Promise.all(
    [1, 2].map(() =>
      f.execution.start(...f.args, p.id, { expectedDigest: p.digest, acknowledged: true }, true),
    ),
  )
  assert.equal((await terminal(f)).code, 'huawei_review_submitted')
  assert.equal(runs, 1)
  const restored = await new FileReleasePlanStore(f.file).list(...f.args)
  assert.equal(restored[0]?.digest, p.digest)
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).schemaVersion, 16)
  const { requestId: _requestId, huaweiAction: _action, ...batchInput } = body
  assert.equal(isBatchTargetInput(batchInput), true)
  assert.equal(isBatchTargetInput({ ...batchInput, huaweiAction: 'submit_review' }), false)
  const draft = await setup(t, 'android')
  const old = await draft.plans.freeze(...draft.args, draft.input)
  assert.equal(old.snapshot.action, 'huawei_save_draft')
  const disk = JSON.parse(await readFile(draft.file, 'utf8'))
  disk.schemaVersion = 15
  await writeFile(draft.file, JSON.stringify(disk))
  assert.equal(
    (await new FileReleasePlanStore(draft.file).list(...draft.args))[0]?.digest,
    old.digest,
  )
  assert.equal(JSON.parse(await readFile(draft.file, 'utf8')).schemaVersion, 15, '仅读取不升级文件')
})

test('合同拒绝混合渠道来源、缺策略、错误渠道、非递增构建和伪造来源', async (t) => {
  const f = await huaweiFixture(t),
    s = f.plan.snapshot
  for (const snapshot of [
    { ...s, releasePolicy: undefined },
    { ...s, binding: { ...s.binding, channel: 'honor' } },
    { ...s, huawei: { ...s.huawei, publicDigest: 'b'.repeat(64) } },
    { ...s, artifact: { ...s.artifact, identity: { ...s.artifact.identity, buildNumber: '1' } } },
  ])
    assert.equal(isReleasePlanSnapshot(snapshot), false)
  assert.equal(
    isPreflightRecord({ ...s.preflight, huawei: { ...s.huawei, secret: 'untrusted' } }),
    false,
  )
  assert.equal(
    isPreflightOutcome({
      code: 'verified',
      artifact: 'passed',
      authentication: 'passed',
      target: 'passed',
      huawei: s.huawei,
      harmony: {},
    }),
    false,
  )
})
