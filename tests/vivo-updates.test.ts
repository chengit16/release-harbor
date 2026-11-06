/** @description vivo 账号、只读来源、签名、单次更新和独立执行合同验收；仅隔离文件、内存秘密及注入网络。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setup, confirmed, terminal } from './fixtures/release-plans.ts'
import { MemoryCredentialSecrets } from './fixtures/credential-intake.ts'
import { vivoCredentials, vivoDetails, vivoApp } from './fixtures/vivo.ts'
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
import { vivoSignature } from '../packages/provider-app-ship/src/vivo-client.ts'
import {
  configurationFingerprint,
  planFingerprint,
  validateReleasePlanInput,
} from '../packages/domain/src/index.ts'
import {
  isReleasePlanSnapshot,
  isVivoUpdateDetails,
  isReleaseAttempt,
  type ExecutionDiagnostic,
} from '../packages/contracts/src/index.ts'
import { isPreflightOutcome } from '../packages/runner-local/src/preflight-protocol.ts'
import { runRelease } from '../packages/runner-local/src/run-release.ts'

async function fixture(t: test.TestContext) {
  const f = await setup(t, 'android', undefined, { channel: 'vivo' })
  const plan = await confirmed(f),
    vault = join(f.root, 'credentials/profiles.json'),
    secrets = new MemoryCredentialSecrets()
  const material = validateCredentialSubmission('vivo', {
    displayName: '合成 vivo',
    credentials: vivoCredentials,
  }).material
  const store = credentialStore(vault, secrets)
  await store.saveProfile({
    credentialProfile: f.binding.credentialReference,
    platform: 'vivo',
    material,
  })
  plan.snapshot.preflight.profileRevision = await profileRevision(vault)
  resign(plan)
  return {
    ...f,
    plan,
    vault,
    secrets,
    credentials: store,
    file: join(f.root, 'artifacts', f.artifact.id, 'payload.apk'),
  }
}
function resign(plan: Awaited<ReturnType<typeof confirmed>>): void {
  plan.snapshot.configDigest = configurationFingerprint(plan.snapshot)
  plan.digest = planFingerprint(plan.snapshot)
  assert.ok(plan.authorization)
  plan.authorization.planDigest = plan.digest
}
const json = (data: unknown) => new Response(JSON.stringify(data))
/** 路由、签名及材料投影同时断言，测试从不 fallthrough 到真实 fetch。 */
function network(
  f: Awaited<ReturnType<typeof fixture>>,
  options: {
    info?: Record<string, unknown>
    upload?: Record<string, unknown>
    failure?: string
    response?: unknown
  } = {},
) {
  const calls: string[] = [],
    submissions: URLSearchParams[] = []
  const transport: typeof fetch = async (url, init) => {
    assert.equal(String(url), 'https://developer-api.vivo.com.cn/router/rest')
    assert.equal(init?.method, 'POST')
    assert.equal(init?.redirect, 'error')
    assert.ok(init?.body instanceof FormData || init?.body instanceof URLSearchParams)
    const body = init.body,
      params: Record<string, string> = {}
    for (const [k, v] of body.entries()) if (typeof v === 'string' && k !== 'sign') params[k] = v
    assert.equal(body.get('sign'), vivoSignature(params, vivoCredentials.accessSecret))
    assert.equal(params.sign_method, 'HMAC-SHA256')
    const method = params.method ?? ''
    calls.push(method)
    if (options.failure === method) throw new DOMException('private-fixture-error', 'TimeoutError')
    if (method === 'app.query.details')
      return json({ code: 0, subCode: '0', data: options.info ?? vivoApp() })
    if (method === 'app.upload.apk.app') {
      assert.ok(body instanceof FormData)
      const file = body.get('file')
      assert.ok(file instanceof Blob)
      const md5 = createHash('md5')
        .update(Buffer.from(await file.arrayBuffer()))
        .digest('hex')
      assert.equal(params.fileMd5, md5)
      return json({
        code: 0,
        data: {
          packageName: f.application.identifier,
          versionCode: Number(f.plan.snapshot.artifact.identity?.buildNumber),
          versionName: f.plan.snapshot.artifact.identity?.versionName,
          fileMd5: md5,
          serialnumber: 'synthetic-serial',
          ...options.upload,
        },
      })
    }
    assert.equal(method, 'app.sync.update.app')
    assert.ok(body instanceof URLSearchParams)
    submissions.push(body)
    assert.deepEqual(
      Object.keys(params).sort(),
      [
        'access_key',
        'timestamp',
        'format',
        'v',
        'sign_method',
        'target_app_key',
        'method',
        'packageName',
        'versionCode',
        'fileMd5',
        'apk',
        'compatibleDevice',
        'updateDesc',
        'onlineType',
        ...(f.plan.snapshot.releasePolicy?.mode === 'scheduled' ? ['scheOnlineTime'] : []),
      ].sort(),
    )
    return json(options.response ?? { code: 0, subCode: '0' })
  }
  return { transport, calls, submissions }
}

test('vivo 材料在安全库保存与重新核对，公开目录／来源拒绝秘密和错误平台绑定', async (t) => {
  const f = await fixture(t),
    repo = localCredentialRepository(f.vault, f.secrets)
  assert.equal(await repo.check(f.binding.credentialReference, 'vivo'), true)
  assert.equal((await repo.catalog()).profiles[0]?.channel, 'vivo')
  assert.ok(!(await readFile(f.vault, 'utf8')).includes(vivoCredentials.accessSecret))
  for (const credentials of [
    { ...vivoCredentials, accessSecret: '' },
    { ...vivoCredentials, accessKey: 'a\nb' },
    { ...vivoCredentials, clientId: 'extra' },
  ])
    assert.throws(() => validateCredentialSubmission('vivo', { displayName: '合成', credentials }))
  assert.equal(isVivoUpdateDetails({ ...vivoDetails, testAccount: 'private' }), false)
  await assert.rejects(
    f.catalog.updateBinding(...f.args, f.binding.id, {
      appId: '123',
      credentialReference: f.binding.credentialReference,
      expectedRevision: 1,
    }),
    /目标必须/,
  )
  const n = network(f),
    result = await checkMerchant(
      {
        channel: 'vivo',
        reference: f.binding.credentialReference,
        identifier: f.application.identifier,
        appId: f.application.identifier,
      },
      f.credentials,
      n.transport,
    )
  assert.deepEqual(result, {
    code: 'verified',
    authentication: 'passed',
    target: 'passed',
    vivo: vivoDetails,
  })
  assert.ok(isPreflightOutcome({ ...result, artifact: 'passed' }))
  assert.deepEqual(n.calls, ['app.query.details'])
  assert.ok(!JSON.stringify(result).includes('private-fixture'))
  assert.equal(
    vivoSignature({ z: '中 & +', a: '=' }, 'key'),
    createHmac('sha256', 'key').update('a==&z=中 & +').digest('hex'),
  )
})

test('vivo 只读核验拒绝游戏、在审、待上架、缺失字段与错目标，不伪装成功或发写请求', async (t) => {
  const f = await fixture(t)
  for (const patch of [
    { packageName: 'com.wrong.app' },
    { appType: 2 },
    { status: 2 },
    { status: 1 },
    { saleStatus: 0 },
    { compatibleDevice: null },
    { versionCode: 'bad' },
    { compatibleDevice: undefined },
  ]) {
    const n = network(f, { info: { ...vivoApp(), ...patch } }),
      r = await checkMerchant(
        {
          channel: 'vivo',
          reference: f.binding.credentialReference,
          identifier: f.application.identifier,
          appId: f.application.identifier,
        },
        f.credentials,
        n.transport,
      )
    assert.notEqual(r.code, 'verified')
    assert.equal(r.vivo, undefined)
    assert.deepEqual(n.calls, ['app.query.details'])
  }
  for (const [response, code] of [
    [{ code: 10001, msg: 'private' }, 'invalid_credentials'],
    [{ code: 10006 }, 'query_rate_limited'],
    [{ code: 0, subCode: '11001' }, 'application_mismatch'],
    [{ code: 0, subCode: null }, 'invalid_response'],
    [{ code: 0, data: [] }, 'invalid_response'],
  ] as const) {
    const r = await checkMerchant(
      {
        channel: 'vivo',
        reference: f.binding.credentialReference,
        identifier: f.application.identifier,
        appId: f.application.identifier,
      },
      f.credentials,
      async () => json(response),
    )
    assert.equal(r.code, code)
  }
})

test('vivo 立即与定时策略准确发送，查询上传提交各一次且只在许可后写入', async (t) => {
  for (const scheduled of [false, true]) {
    const f = await fixture(t)
    if (scheduled)
      f.plan.snapshot.releasePolicy = {
        mode: 'scheduled',
        notBefore: new Date(Date.now() + 86400000).toISOString(),
      }
    resign(f.plan)
    const n = network(f)
    let permits = 0
    const result = await submitVivoUpdate(
      f.plan,
      f.file,
      f.vault,
      async () => {
        assert.deepEqual(n.calls, ['app.query.details'])
        permits++
      },
      f.credentials,
      { transport: n.transport },
    )
    assert.equal(result, 'vivo_update_accepted')
    assert.equal(permits, 1)
    assert.deepEqual(n.calls, ['app.query.details', 'app.upload.apk.app', 'app.sync.update.app'])
    const p = n.submissions[0]
    assert.ok(p)
    assert.equal(p.get('compatibleDevice'), '2')
    assert.equal(p.get('onlineType'), scheduled ? '2' : '1')
    if (f.plan.snapshot.releasePolicy?.mode === 'scheduled')
      assert.equal(
        p.get('scheOnlineTime'),
        new Date(Date.parse(f.plan.snapshot.releasePolicy.notBefore) + 8 * 3600000)
          .toISOString()
          .slice(0, 19)
          .replace('T', ' '),
      )
    else assert.equal(p.has('scheOnlineTime'), false)
  }
})

test('vivo 来源改变、版本未递增、字节改变、拒绝许可或过期时间均在写入前停止', async (t) => {
  for (const reason of ['source', 'version', 'bytes', 'permit', 'time']) {
    const f = await fixture(t)
    const n = network(f, {
      info:
        reason === 'source'
          ? { ...vivoApp(), versionCode: 5 }
          : reason === 'version'
            ? { ...vivoApp(), versionCode: 42 }
            : undefined,
    })
    if (reason === 'bytes') await writeFile(f.file, 'changed')
    if (reason === 'time')
      f.plan.snapshot.releasePolicy = {
        mode: 'scheduled',
        notBefore: new Date(Date.now() - 1000).toISOString(),
      }
    const r = await submitVivoUpdate(
      f.plan,
      f.file,
      f.vault,
      async () => {
        if (reason === 'permit') throw new Error()
      },
      f.credentials,
      { transport: n.transport },
    )
    assert.equal(r, 'verification_failed')
    assert.ok(!n.calls.includes('app.upload.apk.app'))
  }
})

test('vivo 上传不匹配不继续更新，非零业务码、格式、网络错误保持待核对且不重试', async (t) => {
  const cases = [
    { upload: { fileMd5: '0'.repeat(32) } },
    { upload: { packageName: 'com.wrong.app' } },
    { upload: { serialnumber: '' } },
    { upload: { versionCode: 1 } },
    { failure: 'app.upload.apk.app' },
    { failure: 'app.sync.update.app' },
    { response: { code: 0, subCode: '22011', msg: 'private-secret' } },
    { response: { code: 0, subCode: '12010' } },
    { response: { code: 0, subCode: '20016' } },
    { response: { code: 10006 } },
    { response: { code: 0, subCode: '99999' } },
    { response: { success: true } },
  ]
  for (const options of cases) {
    const f = await fixture(t),
      n = network(f, options),
      diagnostics: ExecutionDiagnostic[] = []
    const r = await submitVivoUpdate(f.plan, f.file, f.vault, async () => {}, f.credentials, {
      transport: n.transport,
      report: (d) => diagnostics.push(d),
    })
    assert.equal(r, 'needs_reconciliation')
    assert.equal(n.calls.filter((x) => x === 'app.upload.apk.app').length, 1)
    assert.ok(n.calls.filter((x) => x === 'app.sync.update.app').length <= 1)
    if (options.upload || options.failure === 'app.upload.apk.app')
      assert.equal(n.submissions.length, 0)
    assert.ok(!JSON.stringify(diagnostics).includes('private'))
    if (options.response && 'subCode' in options.response && options.response.subCode === '22011')
      assert.equal(diagnostics.at(-1), 'vivo_release_time_invalid')
  }
})

test('vivo 计划来源只来自预检，版本和说明限制不可绕过，旧文件迁移不重写原摘要', async (t) => {
  const f = await fixture(t)
  assert.ok(isReleasePlanSnapshot(f.plan.snapshot))
  assert.equal(
    isReleasePlanSnapshot({ ...f.plan.snapshot, vivo: { ...vivoDetails, sourceVersionCode: '7' } }),
    false,
  )
  for (const releaseNotes of ['太短', '长'.repeat(201)])
    assert.throws(() => validateReleasePlanInput({ ...f.input, releaseNotes }))
  await assert.rejects(
    f.plans.freeze(...f.args, { ...f.input, requestId: randomUUID(), vivo: vivoDetails }),
  )
  const legacy = JSON.parse(await readFile(join(f.root, 'release-plans.json'), 'utf8'))
  legacy.schemaVersion = 7
  delete legacy.batches
  delete legacy.appleReviews
  await writeFile(join(f.root, 'release-plans.json'), JSON.stringify(legacy))
  assert.equal((await f.plans.list(...f.args))[0]?.plan.digest, legacy.plans[0].digest)
})

test('vivo 单次确认与重复点击只创建一个执行尝试，刷新保留明确接收结果', async (t) => {
  let writes = 0
  const f = await setup(
    t,
    'android',
    {
      async run(_p, _id, before) {
        await before()
        writes++
        return 'vivo_update_accepted'
      },
      close() {},
    },
    { channel: 'vivo' },
  )
  const plan = await confirmed(f)
  const [a, b] = await Promise.all([
    f.execution.start(...f.args, plan.id, { expectedDigest: plan.digest, acknowledged: true }),
    f.execution.start(...f.args, plan.id, { expectedDigest: plan.digest, acknowledged: true }),
  ])
  assert.equal(a.id, b.id)
  const result = await terminal(f)
  assert.equal(result.code, 'vivo_update_accepted')
  assert.equal(result.status, 'succeeded')
  assert.equal(writes, 1)
  assert.ok(isReleaseAttempt(result))
})

test('vivo 实际 APK 完整 runner 独立复核，一次目标查询、一次许可，回执不冒充已上架', async (t) => {
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
  resign(f.plan)
  const n = network(f)
  let permits = 0
  const r = await runRelease(
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
      submitOppoUpdate,
      submitMeizuUpdate,
      submitHonorUpdate,
      submitVivoUpdate: (p, file, vault, permit, store, ports) =>
        submitVivoUpdate(p, file, vault, permit, store, { ...ports, transport: n.transport }),
    },
  )
  assert.equal(r, 'vivo_update_accepted')
  assert.equal(permits, 1)
  assert.equal(n.calls.filter((x) => x === 'app.query.details').length, 1)
})
