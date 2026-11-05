/** @description OPPO 账号、严格资料复用、独立执行及异步任务回执验收；全部使用隔离文件、内存秘密和受控网络。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setup, confirmed, terminal } from './fixtures/release-plans.ts'
import { MemoryCredentialSecrets } from './fixtures/credential-intake.ts'
import { oppoApp, oppoCredentials, oppoDetails } from './fixtures/oppo.ts'
import { syntheticApk } from './fixtures/apk.ts'
import {
  credentialStore,
  profileRevision,
  validateCredentialSubmission,
  localCredentialRepository,
  checkMerchant,
  saveHuaweiDraft,
  submitXiaomiUpdate,
  submitOppoUpdate,
  submitVivoUpdate,
  submitMeizuUpdate,
  submitHonorUpdate,
} from '../packages/provider-app-ship/src/index.ts'
import { oppoSignature, isOppoUploadUrl } from '../packages/provider-app-ship/src/oppo-client.ts'
import { configurationFingerprint, planFingerprint } from '../packages/domain/src/index.ts'
import {
  isReleasePlanSnapshot,
  isOppoUpdateDetails,
  type ExecutionDiagnostic,
} from '../packages/contracts/src/index.ts'
import { isPreflightOutcome } from '../packages/runner-local/src/preflight-protocol.ts'
import { runRelease } from '../packages/runner-local/src/run-release.ts'

async function fixture(t: test.TestContext) {
  const f = await setup(t, 'android', undefined, { channel: 'oppo' })
  const plan = await confirmed(f),
    vault = join(f.root, 'credentials/profiles.json'),
    secrets = new MemoryCredentialSecrets()
  const { material } = validateCredentialSubmission('oppo', {
    displayName: '合成 OPPO',
    credentials: oppoCredentials,
  })
  const store = credentialStore(vault, secrets)
  await store.saveProfile({
    credentialProfile: f.binding.credentialReference,
    platform: 'oppo',
    material,
  })
  plan.snapshot.preflight.profileRevision = await profileRevision(vault)
  plan.snapshot.configDigest = configurationFingerprint(plan.snapshot)
  plan.digest = planFingerprint(plan.snapshot)
  assert.ok(plan.authorization)
  plan.authorization.planDigest = plan.digest
  return {
    ...f,
    plan,
    vault,
    secrets,
    credentials: store,
    file: join(f.root, 'artifacts', f.artifact.id, 'payload.apk'),
  }
}
const json = (data: unknown) => new Response(JSON.stringify({ errno: 0, data }))
/** 仅固定假平台地址可匹配，任何意外网络入口都使测试失败。 */
function network(
  f: Awaited<ReturnType<typeof fixture>>,
  options: {
    info?: Record<string, unknown>
    task?: string
    uploadUrl?: string
    fail?: string
  } = {},
) {
  const calls: string[] = [],
    submissions: URLSearchParams[] = []
  const transport: typeof fetch = async (raw, init) => {
    const u = new URL(String(raw))
    assert.equal(u.hostname, 'oop-openapi-cn.heytapmobi.com')
    const path = u.pathname
    calls.push(path)
    if (path === '/developer/v1/token') return json({ access_token: 'synthetic-private-token' })
    if (path === '/resource/v1/app/info') return json(options.info ?? oppoApp())
    if (path === '/resource/v1/upload/get-upload-url')
      return json({
        upload_url: options.uploadUrl ?? 'https://oop-openapi-cn.heytapmobi.com/upload/synthetic',
        sign: 'synthetic-private-sign',
      })
    if (path === '/upload/synthetic') {
      assert.ok(init?.body instanceof FormData)
      const file = init.body.get('file')
      assert.ok(file instanceof Blob)
      const bytes = Buffer.from(await file.arrayBuffer())
      return json({
        url: 'https://storepic.oppomobile.com/synthetic.apk',
        md5:
          options.fail === 'hash' ? '0'.repeat(32) : createHash('md5').update(bytes).digest('hex'),
        file_size: bytes.length,
      })
    }
    if (path === '/resource/v1/app/upd') {
      assert.ok(init?.body instanceof URLSearchParams)
      const params = new URLSearchParams(init.body)
      submissions.push(params)
      const signed = Object.fromEntries(params)
      delete signed.api_sign
      assert.equal(params.get('api_sign'), oppoSignature(signed, oppoCredentials.clientSecret))
      assert.equal(params.get('test_desc'), oppoApp().test_desc)
      assert.equal(params.get('version_type'), '2')
      assert.equal(params.get('version_code'), f.plan.snapshot.artifact.identity?.buildNumber)
      assert.equal(JSON.parse(params.get('apk_url') ?? '[]')[0].cpu_code, 0)
      if (options.fail === 'timeout')
        throw new DOMException('synthetic-private-message', 'TimeoutError')
      return json({ success: true })
    }
    assert.equal(path, '/resource/v1/app/task-state')
    return json({
      pkg_name: options.fail === 'target' ? 'com.wrong.app' : 'com.example.android',
      version_code: f.plan.snapshot.artifact.identity?.buildNumber,
      task_state: options.task ?? '2',
      err_msg: 'synthetic-private-vendor-error',
    })
  }
  return { transport, calls, submissions }
}

test('OPPO 页面材料、安全目录和重新核对复用现有边界，拒绝错长凭据、目标与公开秘密', async (t) => {
  const f = await fixture(t)
  const repo = localCredentialRepository(f.vault, f.secrets)
  assert.equal(await repo.check(f.binding.credentialReference, 'oppo'), true)
  assert.equal((await repo.catalog()).profiles[0]?.channel, 'oppo')
  for (const patch of [{ clientId: 'short' }, { clientSecret: 'short' }, { privateKey: 'unknown' }])
    assert.throws(() =>
      validateCredentialSubmission('oppo', {
        displayName: '合成',
        credentials: { ...oppoCredentials, ...patch },
      }),
    )
  const disk = await readFile(f.vault, 'utf8')
  assert.ok(!disk.includes(oppoCredentials.clientSecret))
  await assert.rejects(
    f.catalog.updateBinding(...f.args, f.binding.id, {
      appId: '123456',
      credentialReference: f.binding.credentialReference,
      expectedRevision: 1,
    }),
    /目标必须/,
  )
  assert.equal(
    isOppoUpdateDetails({ ...oppoDetails, fields: { ...oppoDetails.fields, test_desc: 'secret' } }),
    false,
  )
  const n = network(f)
  const result = await checkMerchant(
    {
      channel: 'oppo',
      reference: f.binding.credentialReference,
      identifier: f.application.identifier,
      appId: f.application.identifier,
    },
    f.credentials,
    n.transport,
  )
  assert.ok(isPreflightOutcome({ ...result, artifact: 'passed' }))
  assert.deepEqual(result.oppo, oppoDetails)
  assert.equal(result.code, 'verified')
  assert.deepEqual(n.calls, ['/developer/v1/token', '/resource/v1/app/info'])
  for (const secret of [
    'synthetic-private',
    'app_secret',
    'server_secret',
    'app_key',
    'business_email',
    'test_desc',
  ])
    assert.ok(!JSON.stringify(result).includes(secret))
})

test('OPPO 已上架普通应用详情省略 release_type 时仍可完成只读核验', async (t) => {
  const f = await fixture(t)
  // 真实详情会省略发布范围字段；保留其余可更新条件，避免合成样本掩盖误拦截。
  const info = oppoApp()
  delete info.release_type
  const n = network(f, { info })
  const result = await checkMerchant(
    {
      channel: 'oppo',
      reference: f.binding.credentialReference,
      identifier: f.application.identifier,
      appId: f.application.identifier,
    },
    f.credentials,
    n.transport,
  )
  assert.equal(result.code, 'verified')
  assert.equal(result.authentication, 'passed')
  assert.equal(result.target, 'passed')
  assert.deepEqual(result.oppo, oppoDetails)
  assert.deepEqual(n.calls, ['/developer/v1/token', '/resource/v1/app/info'])
})

test('OPPO 只读查询默认拒绝资料缺失、平台身份不符、冻结、非普通应用和非上架状态', async (t) => {
  const f = await fixture(t)
  for (const patch of [
    { pkg_name: 'com.wrong.app' },
    { type: 8 },
    { state: '2' },
    { is_freeze: '1' },
    { audit_status_name: '审核中' },
    { release_type: '2' },
    { release_type: null },
    { release_type: '' },
    { release_type: 'unknown' },
    { update_info_check: 1 },
    { test_desc: '' },
    { privacy_source_url: '' },
    { business_email: '' },
    { pic_url: 'https://example.com/1.png' },
    { app_name: '' },
  ]) {
    const n = network(f, { info: { ...oppoApp(), ...patch } })
    const r = await checkMerchant(
      {
        channel: 'oppo',
        reference: f.binding.credentialReference,
        identifier: f.application.identifier,
        appId: f.application.identifier,
      },
      f.credentials,
      n.transport,
    )
    assert.notEqual(r.code, 'verified')
    assert.equal(r.oppo, undefined)
    assert.equal(n.calls.length, 2)
  }
  for (const url of [
    'http://oppo.com/file',
    'https://oppo.com.evil.invalid/file',
    'https://127.0.0.1/file',
    'https://user:pass@oppo.com/file',
    'https://oppo.com:444/file',
  ])
    assert.equal(isOppoUploadUrl(url), false)
})

test('OPPO 立即和定时提交各只有一次上传及写入，任务匹配处理成功才返回成功', async (t) => {
  const f = await fixture(t)
  for (const mode of ['after_approval', 'scheduled'] as const) {
    f.plan.snapshot.releasePolicy =
      mode === 'scheduled' ? { mode, notBefore: '2099-01-02T00:04:05.000Z' } : { mode }
    // 立即模式覆盖缺省详情，定时模式继续覆盖明确的全量字段；二者共用执行前资料复核。
    const info = oppoApp()
    if (mode === 'after_approval') delete info.release_type
    const n = network(f, { info })
    let permits = 0
    assert.equal(
      await submitOppoUpdate(
        f.plan,
        f.file,
        f.vault,
        async () => {
          permits++
        },
        f.credentials,
        { transport: n.transport, wait: async () => {} },
      ),
      'oppo_version_processed',
    )
    assert.equal(permits, 1)
    assert.equal(n.calls.filter((p) => p === '/resource/v1/app/info').length, 1)
    assert.equal(n.calls.filter((p) => p === '/upload/synthetic').length, 1)
    assert.equal(n.submissions.length, 1)
    assert.equal(n.submissions[0]?.get('online_type'), mode === 'scheduled' ? '2' : '1')
    assert.equal(
      n.submissions[0]?.get('sche_online_time'),
      mode === 'scheduled' ? '2099-01-02 08:04:05' : null,
    )
  }
})

test('OPPO 拒绝上传地址或来源变化时零写入，许可后失败和异步处理中均保留具体原因且不重试写入', async (t) => {
  const f = await fixture(t)
  for (const options of [
    { uploadUrl: 'https://127.0.0.1/file' },
    { info: { ...oppoApp(), version_id: '101' } },
  ]) {
    const n = network(f, options)
    let permits = 0
    assert.equal(
      await submitOppoUpdate(
        f.plan,
        f.file,
        f.vault,
        async () => {
          permits++
        },
        f.credentials,
        { transport: n.transport },
      ),
      'verification_failed',
    )
    assert.equal(permits, 0)
    assert.equal(n.submissions.length, 0)
  }
  for (const [options, reason] of [
    [{ task: '1' }, 'oppo_task_pending'],
    [{ task: '3' }, 'oppo_task_failed'],
    [{ fail: 'target' }, 'oppo_task_mismatch'],
    [{ fail: 'hash' }, 'oppo_upload_mismatch'],
    [{ fail: 'timeout' }, 'upload_timeout'],
  ] as const) {
    const n = network(f, options),
      diagnostics: ExecutionDiagnostic[] = []
    const result = await submitOppoUpdate(f.plan, f.file, f.vault, async () => {}, f.credentials, {
      transport: n.transport,
      wait: async () => {},
      report: (code) => diagnostics.push(code),
    })
    assert.equal(result, 'needs_reconciliation')
    assert.equal(diagnostics.at(-1), reason)
    assert.equal(n.calls.filter((p) => p === '/upload/synthetic').length, 1)
    assert.equal(n.submissions.length, options.fail === 'hash' ? 0 : 1)
    assert.ok(!JSON.stringify(diagnostics).includes('synthetic-private'))
  }
})

test('OPPO 确认、持久化和人工核对沿用限定授权，历史版本六不改写指纹', async (t) => {
  let runs = 0
  const f = await setup(
    t,
    'android',
    {
      async run(_p, _id, permit, report) {
        runs++
        await permit()
        report?.('oppo_task_pending')
        return 'needs_reconciliation'
      },
      close() {},
    },
    { channel: 'oppo' },
  )
  const p = await confirmed(f)
  const old = JSON.parse(await readFile(f.file, 'utf8'))
  old.schemaVersion = 6
  delete old.appleReviews
  await writeFile(f.file, JSON.stringify(old))
  assert.equal((await f.store.list(...f.args))[0]?.digest, p.digest)
  const input = { expectedDigest: p.digest, acknowledged: true }
  await Promise.all([
    f.execution.start(...f.args, p.id, input),
    f.execution.start(...f.args, p.id, input),
  ])
  const a = await terminal(f)
  assert.equal(runs, 1)
  assert.equal(a.diagnostic, 'oppo_task_pending')
  const next = await f.plans.freeze(...f.args, { ...f.input, requestId: randomUUID() })
  await assert.rejects(
    f.execution.start(
      ...f.args,
      next.id,
      { expectedDigest: next.digest, acknowledged: true },
      true,
    ),
    /待核对/,
  )
  await assert.rejects(
    f.execution.reconcile(...f.args, a.id, {
      ...input,
      versionName: '1.2.3',
      buildNumber: '42',
      decision: 'draft_present',
    }),
    /渠道动作/,
  )
  await f.execution.reconcile(...f.args, a.id, {
    ...input,
    versionName: '1.2.3',
    buildNumber: '42',
    decision: 'submission_present',
  })
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).schemaVersion, 11)
  assert.equal((await f.store.list(...f.args))[0]?.digest, p.digest)
})

test('OPPO 实际 APK 在完整 runner 独立复核，单次目标查询及许可后任务核对，不放行旧构建号', async (t) => {
  const f = await fixture(t),
    apk = await syntheticApk(f.root)
  assert.ok(apk)
  const s = f.plan.snapshot,
    sha256 = createHash('sha256').update(apk).digest('hex')
  await writeFile(f.file, apk)
  Object.assign(s.artifact, {
    sha256,
    sizeBytes: apk.length,
    expectedSizeBytes: apk.length,
    identity: {
      format: 'apk',
      packageName: f.application.identifier,
      versionName: '0.1.0',
      buildNumber: '7',
      sha256,
      sizeBytes: apk.length,
    },
  })
  s.preflight.artifactSha256 = sha256
  s.configDigest = configurationFingerprint(s)
  f.plan.digest = planFingerprint(s)
  assert.ok(f.plan.authorization)
  f.plan.authorization.planDigest = f.plan.digest
  const n = network(f)
  let permits = 0
  const outcome = await runRelease(
    {
      schemaVersion: 1,
      nonce: 'a'.repeat(32),
      attemptId: randomUUID(),
      plan: f.plan,
      storageRoot: await realpath(join(f.root, 'artifacts')),
      vaultPath: f.vault,
    },
    async () => {
      permits++
    },
    () => {},
    {
      credentialStore: () => f.credentials,
      checkMerchant,
      saveHuaweiDraft,
      submitXiaomiUpdate,
      submitVivoUpdate,
      submitMeizuUpdate,
      submitHonorUpdate,
      submitOppoUpdate: (p, file, vault, permit, store, ports) =>
        submitOppoUpdate(p, file, vault, permit, store, {
          ...ports,
          transport: n.transport,
          wait: async () => {},
        }),
    },
  )
  assert.equal(outcome, 'oppo_version_processed')
  assert.equal(permits, 1)
  assert.equal(n.calls.filter((p) => p === '/resource/v1/app/info').length, 1)
})

test('OPPO 来源不能由客户端伪造、构建号必须递增，非法输入不产生执行许可', async (t) => {
  const f = await fixture(t)
  await assert.rejects(
    f.plans.freeze(...f.args, { ...f.input, requestId: randomUUID(), oppo: oppoDetails }),
  )
  await assert.rejects(
    f.plans.freeze(...f.args, { ...f.input, requestId: randomUUID(), releaseNotes: '短' }),
  )
  const changed = structuredClone(f.plan.snapshot)
  assert.ok(changed.oppo)
  changed.oppo.appName = '另一应用名称'
  assert.equal(isReleasePlanSnapshot(changed), false)
  assert.ok(f.plan.snapshot.artifact.identity)
  f.plan.snapshot.artifact.identity.buildNumber = '1'
  const n = network(f)
  let permits = 0
  assert.equal(
    await submitOppoUpdate(
      f.plan,
      f.file,
      f.vault,
      async () => {
        permits++
      },
      f.credentials,
      { transport: n.transport },
    ),
    'verification_failed',
  )
  assert.equal(permits, 0)
  assert.equal(n.calls.length, 2)
})
