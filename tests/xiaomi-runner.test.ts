/** @description 小米完整独立执行路径回归；真实合成 APK 和内存凭据复现重复只读查询遭拒，绝不请求真实商店。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { writeFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { setup, confirmed } from './fixtures/release-plans.ts'
import { syntheticApk } from './fixtures/apk.ts'
import { xiaomiCredentials } from './fixtures/xiaomi.ts'
import { MemoryCredentialSecrets } from './fixtures/credential-intake.ts'
import {
  credentialStore,
  profileRevision,
  validateCredentialSubmission,
  checkMerchant,
  saveHuaweiDraft,
  submitXiaomiUpdate,
  submitOppoUpdate,
  submitVivoUpdate,
  submitMeizuUpdate,
  submitHonorUpdate,
} from '../packages/provider-app-ship/src/index.ts'
import { configurationFingerprint, planFingerprint } from '../packages/domain/src/index.ts'
import type { BatchExecution } from '../packages/runner-local/src/release-protocol.ts'
import { runRelease } from '../packages/runner-local/src/run-release.ts'

test('小米执行只查询一次目标，避免第二次查询被频率限制而未上传', async (t) => {
  // 长函数保留原因：复用同一实际 APK、凭据与不可变计划，在完整执行入口验证查询次数和异常传播，避免拆成仅覆盖底层的测试。
  // 1. 实际 APK 与副本检查保留，只替换商店网络及安全存储。
  const f = await setup(t, 'android', undefined, { channel: 'xiaomi' })
  const plan = await confirmed(f),
    apk = await syntheticApk(f.root)
  assert.ok(apk, '完整执行回归需要实际 aapt2')
  const vault = join(f.root, 'credentials/profiles.json'),
    store = credentialStore(vault, new MemoryCredentialSecrets())
  const { material } = validateCredentialSubmission('xiaomi', {
    displayName: '合成执行',
    credentials: xiaomiCredentials().credentials,
  })
  await store.saveProfile({
    credentialProfile: plan.snapshot.binding.credentialReference,
    platform: 'xiaomi',
    material,
  })
  const sha256 = createHash('sha256').update(apk).digest('hex')
  await writeFile(join(f.root, 'artifacts', f.artifact.id, 'payload.apk'), apk)
  const s = plan.snapshot
  Object.assign(s.artifact, {
    sha256,
    sizeBytes: apk.length,
    expectedSizeBytes: apk.length,
    identity: {
      format: 'apk',
      packageName: s.application.identifier,
      versionName: '0.1.0',
      buildNumber: '7',
      sha256,
      sizeBytes: apk.length,
    },
  })
  Object.assign(s.preflight, {
    artifactSha256: sha256,
    profileRevision: await profileRevision(vault),
  })
  s.configDigest = configurationFingerprint(s)
  plan.digest = planFingerprint(s)
  assert.ok(plan.authorization)
  plan.authorization.planDigest = plan.digest
  let queries = 0,
    writes = 0,
    permits = 0
  // 2. 第一次只读通过，第二次明确遭频率限制，复现实际调用链而非只测底层适配器。
  const transport: typeof fetch = async (url) => {
    if (String(url).endsWith('/query')) {
      queries++
      return new Response(
        JSON.stringify(
          queries === 1
            ? {
                result: 0,
                create: false,
                updateVersion: true,
                packageInfo: { packageName: s.application.identifier, appName: s.xiaomi?.appName },
              }
            : { result: -20035, message: '合成查询频率限制' },
        ),
      )
    }
    assert.equal(String(url), 'https://api.developer.xiaomi.com/devupload/dev/push')
    assert.equal(permits, 1)
    writes++
    return new Response('{"result":0}')
  }
  // 3. 应保留一次有效核对与写入许可；不能通过删除全部核对让测试通过。
  const diagnostics: string[] = []
  const result = await runRelease(
    {
      schemaVersion: 1,
      nonce: 'a'.repeat(32),
      attemptId: '11111111-1111-4111-8111-111111111111',
      plan,
      storageRoot: await realpath(join(f.root, 'artifacts')),
      vaultPath: vault,
    },
    async () => {
      permits++
    },
    (code) => diagnostics.push(code),
    {
      credentialStore: () => store,
      checkMerchant: (input, credentials) => checkMerchant(input, credentials, transport),
      saveHuaweiDraft,
      submitOppoUpdate,
      submitVivoUpdate,
      submitMeizuUpdate,
      submitHonorUpdate,
      submitXiaomiUpdate: (p, file, path, before, credentials, _transport, report) =>
        submitXiaomiUpdate(p, file, path, before, credentials, transport, report),
    },
  )
  assert.equal(
    result,
    'review_submitted',
    JSON.stringify({ queries, writes, permits, diagnostics }),
  )
  assert.equal(queries, 1)
  assert.equal(writes, 1)
  assert.equal(permits, 1)
  // 批次保持 frozen 和旧检查时间，靠完整摘要归属及当前独立复核取得新许可。
  const batchPlan = structuredClone(plan)
  batchPlan.status = 'frozen'
  batchPlan.authorization = null
  batchPlan.snapshot.preflight.createdAt = new Date(Date.now() - 600000).toISOString()
  batchPlan.snapshot.preflight.checkedAt = new Date(Date.now() - 600000).toISOString()
  batchPlan.snapshot.preflight.expiresAt = new Date(Date.now() - 300000).toISOString()
  batchPlan.snapshot.configDigest = configurationFingerprint(batchPlan.snapshot)
  batchPlan.digest = planFingerprint(batchPlan.snapshot)
  const targetId = randomUUID(),
    revisionId = randomUUID(),
    issuedAt = new Date().toISOString()
  const manifest: BatchExecution['manifest'] = {
    id: revisionId,
    targets: [
      {
        id: targetId,
        planId: batchPlan.id,
        digest: batchPlan.digest,
        input: {
          bindingId: s.binding.id,
          expectedBindingRevision: s.binding.revision,
          artifactId: s.artifact.id,
          expectedArtifactSha256: sha256,
          releaseNotes: s.releaseNotes,
          releasePolicy: { mode: 'after_approval' },
        },
      },
    ],
  }
  const batch: BatchExecution = {
    batchId: randomUUID(),
    revisionId,
    targetId,
    manifest,
    consent: {
      id: randomUUID(),
      scope: 'local_batch_once',
      digest: planFingerprint(manifest),
      issuedAt,
      expiresAt: new Date(Date.parse(issuedAt) + 3600000).toISOString(),
    },
  }
  const batchTask = {
    schemaVersion: 1 as const,
    nonce: 'c'.repeat(32),
    attemptId: randomUUID(),
    plan: batchPlan,
    batch,
    storageRoot: await realpath(join(f.root, 'artifacts')),
    vaultPath: vault,
  }
  const batchProvider = {
    credentialStore: () => store,
    checkMerchant,
    saveHuaweiDraft,
    submitOppoUpdate,
    submitVivoUpdate,
    submitMeizuUpdate,
    submitHonorUpdate,
    submitXiaomiUpdate: (...args: Parameters<typeof submitXiaomiUpdate>) =>
      submitXiaomiUpdate(args[0], args[1], args[2], args[3], args[4], transport, args[6]),
  }
  queries = 0
  writes = 0
  permits = 0
  assert.equal(
    await runRelease(
      batchTask,
      async (validation) => {
        assert.equal(validation?.targetId, targetId)
        assert.equal(validation?.planDigest, batchPlan.digest)
        assert.ok(validation?.checkedAt && Date.parse(validation.checkedAt) >= Date.parse(issuedAt))
        permits++
      },
      () => undefined,
      batchProvider,
    ),
    'review_submitted',
  )
  assert.equal(queries, 1)
  assert.equal(writes, 1)
  assert.equal(permits, 1)
  const tampered = structuredClone(batchTask)
  tampered.batch.manifest.targets[0]?.input &&
    (tampered.batch.manifest.targets[0].input.releaseNotes = '未经确认的说明')
  queries = 0
  writes = 0
  permits = 0
  assert.equal(
    await runRelease(
      tampered,
      async () => {
        permits++
      },
      () => undefined,
      batchProvider,
    ),
    'verification_failed',
  )
  assert.equal(queries, 0)
  assert.equal(writes, 0)
  assert.equal(permits, 0)
  // 传输及回执异常穿过真实 runner 回传固定原因，保持待核对、单次请求且不泄露正文。
  const failures = [
    {
      expected: 'upload_timeout',
      response: () => {
        throw new DOMException('合成私有正文', 'TimeoutError')
      },
    },
    {
      expected: 'upload_aborted',
      response: () => {
        throw new DOMException('合成私有正文', 'AbortError')
      },
    },
    {
      expected: 'upload_timeout',
      response: () => {
        throw new TypeError('合成私有正文', { cause: { code: 'UND_ERR_BODY_TIMEOUT' } })
      },
    },
    {
      expected: 'upload_network_error',
      response: () => {
        throw new TypeError('合成私有正文', { cause: { code: 'ECONNRESET' } })
      },
    },
    {
      expected: 'upload_http_error',
      response: () => new Response('合成私有正文', { status: 502 }),
    },
    { expected: 'upload_invalid_response', response: () => new Response('合成私有正文') },
    { expected: 'upload_invalid_response', response: () => new Response('{}') },
    { expected: 'upload_invalid_response', response: () => new Response('x'.repeat(65537)) },
    {
      expected: 'upload_rejected',
      response: () => new Response('{"result":-1,"message":"合成私有正文"}'),
    },
  ]
  for (const failure of failures) {
    diagnostics.length = 0
    let failedWrites = 0
    const outcome = await runRelease(
      {
        schemaVersion: 1,
        nonce: 'b'.repeat(32),
        attemptId: '22222222-2222-4222-8222-222222222222',
        plan,
        storageRoot: await realpath(join(f.root, 'artifacts')),
        vaultPath: vault,
      },
      async () => {},
      (code) => diagnostics.push(code),
      {
        credentialStore: () => store,
        checkMerchant,
        saveHuaweiDraft,
        submitOppoUpdate,
        submitVivoUpdate,
        submitMeizuUpdate,
        submitHonorUpdate,
        submitXiaomiUpdate: (p, file, path, before, credentials, _transport, report) =>
          submitXiaomiUpdate(
            p,
            file,
            path,
            before,
            credentials,
            async (url) => {
              if (String(url).endsWith('/query'))
                return new Response(
                  JSON.stringify({
                    result: 0,
                    create: false,
                    updateVersion: true,
                    packageInfo: {
                      packageName: s.application.identifier,
                      appName: s.xiaomi?.appName,
                    },
                  }),
                )
              failedWrites++
              return failure.response()
            },
            report,
          ),
      },
    )
    assert.equal(outcome, 'needs_reconciliation')
    assert.equal(failedWrites, 1)
    assert.equal(diagnostics.at(-1), failure.expected)
    assert.ok(!JSON.stringify(diagnostics).includes('合成私有正文'))
  }
  // 查询本身受限时必须拒绝写入，并给出具体原因；不将限频误报成凭据或图标错误。
  diagnostics.length = 0
  const limited = await submitXiaomiUpdate(
    plan,
    join(f.root, 'artifacts', f.artifact.id, 'payload.apk'),
    vault,
    async () => {
      throw new Error('受限不得申请许可')
    },
    store,
    async () => new Response('{"result":-20035}'),
    (code) => diagnostics.push(code),
  )
  assert.equal(limited, 'verification_failed')
  assert.equal(diagnostics.at(-1), 'merchant_rate_limited')
})
