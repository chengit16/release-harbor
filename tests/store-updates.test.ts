/** @description 魅族与荣耀隔离验收；注入内存账号和固定网络，覆盖来源、定时、单次许可与明确送审事实。 */
import test from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile, realpath, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { setup, confirmed, terminal } from './fixtures/release-plans.ts'
import { syntheticApk } from './fixtures/apk.ts'
import { MemoryCredentialSecrets } from './fixtures/credential-intake.ts'
import {
  storeCredentials,
  meizuApp,
  meizuDetails,
  honorApp,
  honorDetails,
} from './fixtures/store-updates.ts'
import {
  credentialStore,
  profileRevision,
  localCredentialRepository,
  validateCredentialSubmission,
  checkMerchant,
  submitMeizuUpdate,
  submitHonorUpdate,
  submitVivoUpdate,
  submitOppoUpdate,
  submitXiaomiUpdate,
  saveHuaweiDraft,
} from '../packages/provider-app-ship/src/index.ts'
import { meizuHeaders } from '../packages/provider-app-ship/src/store-client.ts'
import { isHonorUploadUrl } from '../packages/provider-app-ship/src/honor-updates.ts'
import {
  configurationFingerprint,
  planFingerprint,
  validateReleasePlanInput,
} from '../packages/domain/src/index.ts'
import {
  isReleasePlanSnapshot,
  isMeizuUpdateDetails,
  isHonorUpdateDetails,
  type ExecutionDiagnostic,
  type ReviewAnchor,
} from '../packages/contracts/src/index.ts'
import { runRelease } from '../packages/runner-local/src/run-release.ts'

type Channel = 'meizu' | 'honor'
async function fixture(t: test.TestContext, channel: Channel) {
  const f = await setup(t, 'android', undefined, { channel }),
    plan = await confirmed(f),
    vault = join(f.root, 'credentials/profiles.json'),
    secrets = new MemoryCredentialSecrets(),
    credentials = credentialStore(vault, secrets)
  await credentials.saveProfile({
    credentialProfile: f.binding.credentialReference,
    platform: channel,
    material: validateCredentialSubmission(channel, {
      displayName: '合成商店',
      credentials: storeCredentials,
    }).material,
  })
  const apk = await syntheticApk(f.root)
  assert.ok(apk)
  const file = join(f.root, 'artifacts', f.artifact.id, 'payload.apk'),
    s = plan.snapshot,
    sha256 = createHash('sha256').update(apk).digest('hex')
  await writeFile(file, apk)
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
  s.preflight.profileRevision = await profileRevision(vault)
  resign(plan)
  return { ...f, plan, vault, secrets, credentials, artifactFile: file, channel }
}
function resign(plan: Awaited<ReturnType<typeof confirmed>>): void {
  plan.snapshot.configDigest = configurationFingerprint(plan.snapshot)
  plan.digest = planFingerprint(plan.snapshot)
  assert.ok(plan.authorization)
  plan.authorization.planDigest = plan.digest
}
const json = (body: unknown) => new Response(JSON.stringify(body))
/**
 * 所有固定网关均由替身响应，不允许意外请求落到真实 fetch。
 * 长函数保留原因：两个平台共享一次调用记录，按路由断言完整数据流，避免把替身拆成无法检查顺序的零散结果。
 */
function network(
  f: Awaited<ReturnType<typeof fixture>>,
  options: {
    source?: Record<string, unknown>
    fail?: string
    badReceipt?: boolean
    duplicate?: boolean
    total?: number
  } = {},
) {
  const calls: string[] = [],
    bodies: Record<string, unknown>[] = [],
    headers: Headers[] = []
  let bound = false
  const transport: typeof fetch = async (raw, init) => {
    const u = new URL(String(raw)),
      h = new Headers(init?.headers)
    headers.push(h)
    assert.equal(init?.redirect, 'error')
    const route = u.pathname.split('/').at(-1) ?? ''
    calls.push(route)
    if (options.fail === route) throw new DOMException('private-platform-message', 'TimeoutError')
    if (f.channel === 'meizu') {
      assert.equal(u.origin, 'https://developer.meizu.com')
      if (route === 'token') {
        assert.equal(h.get('clientsecret'), storeCredentials.clientSecret)
        return json({ code: 200, value: { accessToken: 'synthetic-token' } })
      }
      const expected = meizuHeaders(
        storeCredentials,
        'synthetic-token',
        u.pathname,
        h.get('timestamp') ?? '',
        h.get('traceid') ?? '',
      )
      assert.equal(h.get('sign'), expected.sign)
      const app = options.source ?? meizuApp()
      if (route === 'list')
        return json({
          code: 200,
          value: {
            total: options.total ?? (options.duplicate ? 2 : 1),
            data: options.duplicate
              ? [
                  { id: 123456, verId: 100, pkgName: f.application.identifier, status: 50 },
                  { id: 123457, verId: 101, pkgName: f.application.identifier, status: 50 },
                ]
              : [
                  {
                    id: 123456,
                    verId: 100,
                    pkgName: f.application.identifier,
                    status: 50,
                    replaceStatus: -1,
                  },
                ],
          },
        })
      if (route === 'detail')
        return json({
          code: 200,
          value:
            u.searchParams.get('verId') === '200'
              ? {
                  ...app,
                  verId: 200,
                  versionName: f.plan.snapshot.artifact.identity?.versionName,
                  status: options.badReceipt ? 50 : 20,
                }
              : app,
        })
      if (route === 'upload') {
        assert.ok(init?.body instanceof FormData)
        const file = init.body.get('file')
        assert.ok(file instanceof Blob)
        assert.equal(
          createHash('sha256')
            .update(Buffer.from(await file.arrayBuffer()))
            .digest('hex'),
          f.plan.snapshot.artifact.sha256,
        )
        return json({ code: 200, value: { destFileName: 'synthetic-apk-path' } })
      }
      assert.equal(route, 'publish')
      const body: unknown = JSON.parse(String(init?.body))
      assert.ok(body && typeof body === 'object')
      if (!('packageUrl' in body)) assert.fail('缺少安装包')
      bodies.push(body)
      assert.equal(body.packageUrl, 'synthetic-apk-path')
      assert.ok('devContact' in body)
      assert.equal(body.devContact, 'private-contact-sentinel')
      return json({ code: 200, value: { verId: 200 } })
    }
    if (route === 'token') {
      assert.equal(u.origin, 'https://iam.developer.honor.com')
      return json({ access_token: 'synthetic-token' })
    }
    assert.equal(u.origin, 'https://appmarket-openapi-drcn.cloud.honor.com')
    assert.equal(h.get('authorization'), 'Bearer synthetic-token')
    if (route === 'get-app-id')
      return json({ code: 0, data: [{ appId: 123456, packageName: f.application.identifier }] })
    if (route === 'get-app-detail')
      return json({
        code: 0,
        data: {
          ...(options.source ?? honorApp()),
          ...(bound
            ? {
                fileInfo: [
                  {
                    fileType: 100,
                    fileSha256: options.badReceipt
                      ? '0'.repeat(64)
                      : f.plan.snapshot.artifact.sha256,
                  },
                ],
              }
            : {}),
        },
      })
    if (route === 'get-app-current-release')
      return json({
        code: 0,
        data: bound
          ? {
              releaseId: '200',
              versionCode: 7,
              versionName: f.plan.snapshot.artifact.identity?.versionName,
              auditResult: 4,
            }
          : { releaseId: '100', versionCode: 6, versionName: '1.0.0', auditResult: 1 },
      })
    if (route === 'get-file-upload-url') {
      const b = JSON.parse(String(init?.body))
      assert.equal(b[0].fileSha256, f.plan.snapshot.artifact.sha256)
      return json({
        code: 0,
        data: [
          {
            objectId: 1234,
            fileName: 'payload.apk',
            expireTime: Math.floor(Date.now() / 1000) + 600,
            uploadUrl:
              'https://appmarket-openapi-drcn.cloud.honor.com/openapi/v1/publish/file-upload?appId=123456&objectId=1234',
          },
        ],
      })
    }
    if (route === 'file-upload') {
      assert.ok(init?.body instanceof FormData)
      return json({ code: 0 })
    }
    const body = JSON.parse(String(init?.body))
    bodies.push(body)
    if (route === 'update-file-info') {
      assert.deepEqual(body, { bindingFileList: [{ objectId: 1234 }] })
      bound = true
      return json({ code: 0 })
    }
    if (route === 'update-language-info') {
      assert.equal(body.setAll, 0)
      assert.equal(body.languageInfoList.length, 1)
      assert.equal(body.languageInfoList[0].languageId, 'zh-CN')
      assert.equal(body.languageInfoList[0].newFeature, f.plan.snapshot.releaseNotes)
      return json({ code: 0 })
    }
    assert.equal(route, 'submit-audit')
    assert.equal(body.testPassword, 'private-test-password')
    assert.ok(!JSON.stringify(body).includes('private-secretkey-sentinel'))
    return json({ code: 0, data: '300' })
  }
  return { transport, calls, bodies, headers }
}

for (const channel of ['meizu', 'honor'] as const) {
  test(`${channel} 账号、安全来源与只读目标核对不含私人资料且不请求写接口`, async (t) => {
    const f = await fixture(t, channel),
      repo = localCredentialRepository(f.vault, f.secrets)
    assert.equal(await repo.check(f.binding.credentialReference, channel), true)
    assert.equal((await repo.catalog()).profiles[0]?.channel, channel)
    assert.ok(!(await readFile(f.vault, 'utf8')).includes(storeCredentials.clientSecret))
    assert.throws(() =>
      validateCredentialSubmission(channel, {
        displayName: '合成',
        credentials: { ...storeCredentials, extra: 'bad' },
      }),
    )
    const n = network(f),
      r = await checkMerchant(
        {
          channel,
          reference: f.binding.credentialReference,
          identifier: f.application.identifier,
          appId: f.binding.appId,
        },
        f.credentials,
        n.transport,
      )
    assert.equal(r.code, 'verified')
    assert.ok(!JSON.stringify(r).includes('private-'))
    assert.ok(!n.calls.includes('upload') && !n.calls.includes('get-file-upload-url'))
    assert.ok(isReleasePlanSnapshot(f.plan.snapshot))
    assert.equal(
      channel === 'meizu'
        ? isMeizuUpdateDetails({ ...meizuDetails, devContact: 'private' })
        : isHonorUpdateDetails({ ...honorDetails, secretKey: 'private' }),
      false,
    )
  })
  test(`${channel} 单次许可后完成真实协议链路，刷新或再次点击不重放`, async (t) => {
    const f = await fixture(t, channel),
      n = network(f)
    let permit = 0
    const submit = channel === 'meizu' ? submitMeizuUpdate : submitHonorUpdate
    const r = await submit(
      f.plan,
      f.artifactFile,
      f.vault,
      async () => {
        assert.ok(!n.calls.includes('upload') && !n.calls.includes('get-file-upload-url'))
        permit++
      },
      f.credentials,
      { transport: n.transport },
    )
    assert.equal(r, channel === 'meizu' ? 'meizu_review_submitted' : 'honor_review_submitted')
    assert.equal(permit, 1)
    assert.equal(
      n.calls.filter((x) => x === (channel === 'meizu' ? 'publish' : 'submit-audit')).length,
      1,
    )
  })
  test(`${channel} 来源变化或错误目标在许可前停止，上传后回执缺失及网络错误须人工核对`, async (t) => {
    const f = await fixture(t, channel),
      submit = channel === 'meizu' ? submitMeizuUpdate : submitHonorUpdate
    const changed =
      channel === 'meizu'
        ? { ...meizuApp(), name: '改名' }
        : { ...honorApp(), basicInfo: { appId: 999, packageName: 'wrong' } }
    const n = network(f, { source: changed })
    let permit = 0
    assert.equal(
      await submit(
        f.plan,
        f.artifactFile,
        f.vault,
        async () => {
          permit++
        },
        f.credentials,
        { transport: n.transport },
      ),
      'verification_failed',
    )
    assert.equal(permit, 0)
    for (const options of [
      { badReceipt: true },
      { fail: channel === 'meizu' ? 'upload' : 'file-upload' },
      { fail: channel === 'meizu' ? 'publish' : 'submit-audit' },
    ]) {
      const networkCase = network(f, options),
        diagnostics: ExecutionDiagnostic[] = [],
        anchors: ReviewAnchor[] = []
      assert.equal(
        await submit(f.plan, f.artifactFile, f.vault, async () => {}, f.credentials, {
          transport: networkCase.transport,
          report: (d) => diagnostics.push(d),
          onReviewAnchor: (anchor) => anchors.push(anchor),
        }),
        'needs_reconciliation',
      )
      assert.deepEqual(anchors, [], '回执或详情未核对时不得回报版本锚点')
      assert.ok(!JSON.stringify(diagnostics).includes('private'))
      assert.ok(
        networkCase.calls.filter((x) => x === (channel === 'meizu' ? 'publish' : 'submit-audit'))
          .length <= 1,
      )
    }
  })
  test(`${channel} 完整 runner 复核真实 APK 和限定授权，单次确认保留独立结果`, async (t) => {
    const f = await fixture(t, channel),
      n = network(f)
    let permit = 0
    const anchors: ReviewAnchor[] = []
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
        permit++
      },
      () => {},
      {
        credentialStore: () => f.credentials,
        checkMerchant,
        saveHuaweiDraft,
        submitVivoUpdate,
        submitOppoUpdate,
        submitXiaomiUpdate,
        submitMeizuUpdate: (p, file, vault, permit, store, ports) =>
          submitMeizuUpdate(p, file, vault, permit, store, { ...ports, transport: n.transport }),
        submitHonorUpdate: (p, file, vault, permit, store, ports) =>
          submitHonorUpdate(p, file, vault, permit, store, { ...ports, transport: n.transport }),
      },
      (anchor) => anchors.push(anchor),
    )
    assert.equal(r, channel === 'meizu' ? 'meizu_review_submitted' : 'honor_review_submitted')
    assert.equal(permit, 1)
    assert.deepEqual(anchors, channel === 'meizu' ? [{ channel: 'meizu', versionId: '200' }] : [])
  })
  test(`${channel} 控制面一次确认与重复请求只创建原执行，错误来源不能伪造`, async (t) => {
    let writes = 0
    const f = await setup(
      t,
      'android',
      {
        async run(_plan, _id, permit) {
          await permit()
          writes++
          return channel === 'meizu' ? 'meizu_review_submitted' : 'honor_review_submitted'
        },
        close() {},
      },
      { channel },
    )
    const plan = await f.plans.freeze(...f.args, f.input)
    await assert.rejects(
      f.plans.freeze(...f.args, {
        ...f.input,
        requestId: randomUUID(),
        [channel]: channel === 'meizu' ? meizuDetails : honorDetails,
      }),
    )
    const [a, b] = await Promise.all([
      f.execution.start(
        ...f.args,
        plan.id,
        { expectedDigest: plan.digest, acknowledged: true },
        true,
      ),
      f.execution.start(
        ...f.args,
        plan.id,
        { expectedDigest: plan.digest, acknowledged: true },
        true,
      ),
    ])
    assert.equal(a.id, b.id)
    assert.equal((await terminal(f)).status, 'succeeded')
    assert.equal(writes, 1)
  })
}

test('魅族分页冲突、未知状态及定时意图均明确拒绝，不把定时降级立即', async (t) => {
  const f = await fixture(t, 'meizu')
  assert.throws(() =>
    validateReleasePlanInput({
      ...f.input,
      releasePolicy: {
        mode: 'scheduled',
        notBefore: new Date(Date.now() + 86400000).toISOString(),
      },
    }),
  )
  f.plan.snapshot.releasePolicy = {
    mode: 'scheduled',
    notBefore: new Date(Date.now() + 86400000).toISOString(),
  }
  const n = network(f)
  let permits = 0
  assert.equal(
    await submitMeizuUpdate(
      f.plan,
      f.artifactFile,
      f.vault,
      async () => {
        permits++
      },
      f.credentials,
      { transport: n.transport },
    ),
    'verification_failed',
  )
  assert.equal(n.calls.length, 0)
  assert.equal(permits, 0)
  for (const options of [
    { duplicate: true },
    { total: 1001 },
    { source: { ...meizuApp(), status: 20 } },
  ]) {
    const r = await checkMerchant(
      {
        channel: 'meizu',
        reference: f.binding.credentialReference,
        identifier: f.application.identifier,
        appId: f.binding.appId,
      },
      f.credentials,
      network(f, options).transport,
    )
    assert.notEqual(r.code, 'verified')
  }
})

test('荣耀定时携带明确 UTC 偏移，只修改默认语种，拒绝过期及跨域上传地址', async (t) => {
  const f = await fixture(t, 'honor')
  f.plan.snapshot.releasePolicy = {
    mode: 'scheduled',
    notBefore: new Date(Date.now() + 86400000).toISOString(),
  }
  resign(f.plan)
  const n = network(f)
  assert.equal(
    await submitHonorUpdate(f.plan, f.artifactFile, f.vault, async () => {}, f.credentials, {
      transport: n.transport,
    }),
    'honor_review_submitted',
  )
  const submitted = n.bodies.at(-1)
  assert.equal(submitted?.releaseType, 2)
  assert.equal(
    submitted?.releaseTime,
    f.plan.snapshot.releasePolicy.notBefore.slice(0, 19) + '+0000',
  )
  for (const url of [
    'https://evil.invalid/file',
    'https://appmarket-openapi-drcn.cloud.honor.com.evil.invalid/openapi/v1/publish/file-upload?appId=123456&objectId=1234',
    'http://appmarket-openapi-drcn.cloud.honor.com/openapi/v1/publish/file-upload?appId=123456&objectId=1234',
  ])
    assert.equal(isHonorUploadUrl(url, '123456', '1234'), false)
  f.plan.snapshot.releasePolicy.notBefore = new Date(Date.now() - 1000).toISOString()
  const old = network(f)
  let permits = 0
  assert.equal(
    await submitHonorUpdate(
      f.plan,
      f.artifactFile,
      f.vault,
      async () => {
        permits++
      },
      f.credentials,
      { transport: old.transport },
    ),
    'verification_failed',
  )
  assert.equal(permits, 0)
})

test('两家平台的状态和业务码严格投影，缺失资料与私人材料不进入成功快照', async (t) => {
  for (const channel of ['meizu', 'honor'] as const) {
    const f = await fixture(t, channel)
    const patches =
      channel === 'meizu'
        ? [{ devContact: null }, { categoryId: 2 }, { status: 100 }, { packageName: 'com.wrong' }]
        : [
            { publishInfo: { releaseType: 3, forceUpdate: 0 } },
            {
              publishInfo: {
                releaseType: 2,
                forceUpdate: 0,
                releaseTime: new Date(Date.now() + 86400000).toISOString(),
              },
            },
            { languageInfo: [] },
            {
              basicInfo: { appId: 123456, packageName: f.application.identifier, appCategoryId: 1 },
            },
          ]
    for (const patch of patches) {
      const source = { ...(channel === 'meizu' ? meizuApp() : honorApp()), ...patch }
      const r = await checkMerchant(
        {
          channel,
          reference: f.binding.credentialReference,
          identifier: f.application.identifier,
          appId: f.binding.appId,
        },
        f.credentials,
        network(f, { source }).transport,
      )
      assert.notEqual(r.code, 'verified')
      assert.ok(!JSON.stringify(r).includes('private-'))
    }
    for (const [code, expected] of (channel === 'meizu'
      ? [
          [113033, 'invalid_credentials'],
          [113043, 'application_not_ready'],
          [113003, 'application_mismatch'],
        ]
      : [
          [10003, 'invalid_credentials'],
          [20022, 'application_not_ready'],
          [30011, 'query_rate_limited'],
        ]) as [number, string][]) {
      const n = network(f),
        transport: typeof fetch = async (url, init) =>
          new URL(String(url)).pathname.endsWith('/token')
            ? n.transport(url, init)
            : json({ code, msg: 'private-vendor-text' })
      const r = await checkMerchant(
        {
          channel,
          reference: f.binding.credentialReference,
          identifier: f.application.identifier,
          appId: f.binding.appId,
        },
        f.credentials,
        transport,
      )
      assert.equal(r.code, expected)
      assert.ok(!JSON.stringify(r).includes('private-vendor-text'))
    }
  }
})

test('魅族实际含 32 位库的 APK 在远端许可前停止，不消耗上传接口', async (t) => {
  const f = await fixture(t, 'meizu')
  await mkdir(join(f.root, 'lib/armeabi-v7a'), { recursive: true })
  await writeFile(join(f.root, 'lib/armeabi-v7a/libsynthetic.so'), Buffer.from('synthetic-library'))
  await promisify(execFile)(
    '/usr/bin/zip',
    ['-q', f.artifactFile, 'lib/armeabi-v7a/libsynthetic.so'],
    { cwd: f.root },
  )
  const bytes = await readFile(f.artifactFile),
    s = f.plan.snapshot,
    sha256 = createHash('sha256').update(bytes).digest('hex')
  assert.ok(s.artifact.identity)
  Object.assign(s.artifact, { sha256, sizeBytes: bytes.length, expectedSizeBytes: bytes.length })
  Object.assign(s.artifact.identity, { sha256, sizeBytes: bytes.length })
  s.preflight.artifactSha256 = sha256
  resign(f.plan)
  let permits = 0
  const n = network(f),
    diagnostics: ExecutionDiagnostic[] = []
  assert.equal(
    await submitMeizuUpdate(
      f.plan,
      f.artifactFile,
      f.vault,
      async () => {
        permits++
      },
      f.credentials,
      { transport: n.transport, report: (d) => diagnostics.push(d) },
    ),
    'verification_failed',
  )
  assert.equal(permits, 0)
  assert.ok(!n.calls.includes('upload'))
  assert.equal(diagnostics.at(-1), 'store_version_invalid')
})

test('两家未知结果保留具体原因并阻塞重提，人工核对必须使用送审语义且不改原事实', async (t) => {
  for (const channel of ['meizu', 'honor'] as const) {
    let writes = 0
    const f = await setup(
      t,
      'android',
      {
        async run(_p, _id, permit, report) {
          await permit()
          writes++
          report?.('store_receipt_missing')
          return 'needs_reconciliation'
        },
        close() {},
      },
      { channel },
    )
    const plan = await f.plans.freeze(...f.args, f.input)
    const attempt = await f.execution.start(
      ...f.args,
      plan.id,
      { expectedDigest: plan.digest, acknowledged: true },
      true,
    )
    const original = await terminal(f)
    assert.equal(original.status, 'needs_reconciliation')
    assert.equal(original.diagnostic, 'store_receipt_missing')
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
    assert.ok(plan.snapshot.artifact.identity)
    const input = {
      expectedDigest: plan.digest,
      versionName: plan.snapshot.artifact.identity.versionName,
      buildNumber: plan.snapshot.artifact.identity.buildNumber,
      acknowledged: true,
    }
    await assert.rejects(
      f.execution.reconcile(...f.args, attempt.id, { ...input, decision: 'no_draft' }),
    )
    const checked = await f.execution.reconcile(...f.args, attempt.id, {
      ...input,
      decision: 'not_submitted',
    })
    assert.equal(checked.reconciliation?.decision, 'not_submitted')
    assert.equal(checked.status, 'needs_reconciliation')
    assert.equal(checked.diagnostic, 'store_receipt_missing')
    assert.equal(writes, 1)
    const repeated = await f.execution.start(
      ...f.args,
      plan.id,
      { expectedDigest: plan.digest, acknowledged: true },
      true,
    )
    assert.equal(repeated.id, attempt.id)
    assert.equal(writes, 1)
  }
})
