/** @description 小米账号、查询、更新签名与一次性审核提交验收，使用内存秘密与拦截 transport，禁止真实网络。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { constants, createHash, privateDecrypt, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import {
  isReleasePlan,
  isReleaseAttempt,
  type ReleasePlan,
} from '../packages/contracts/src/index.ts'
import { validateXiaomiUpdateDetails, planFingerprintsMatch } from '../packages/domain/src/index.ts'
import {
  credentialStore,
  localCredentialRepository,
  validateCredentialSubmission,
  profileRevision,
  checkMerchant,
  submitXiaomiUpdate,
} from '../packages/provider-app-ship/src/index.ts'
import { MemoryCredentialSecrets, TestCredentialIntake } from './fixtures/credential-intake.ts'
import { setup, terminal } from './fixtures/release-plans.ts'
import { xiaomiCredentials, xiaomiDetails, xiaomiIcon } from './fixtures/xiaomi.ts'

async function materialFixture(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'harbor-xiaomi-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const vault = join(root, 'credentials/profiles.json')
  const secrets = new MemoryCredentialSecrets()
  const repository = localCredentialRepository(vault, secrets)
  const { pair, credentials } = xiaomiCredentials()
  const { material } = validateCredentialSubmission('xiaomi', {
    displayName: '测试小米',
    credentials,
  })
  await repository.save('synthetic-xiaomi', 'xiaomi', material)
  return {
    root,
    vault,
    secrets,
    repository,
    pair,
    credentials,
    store: credentialStore(vault, secrets),
  }
}
function json(data: unknown): Response {
  return new Response(JSON.stringify(data), { status: 200 })
}
const matched = {
  result: 0,
  updateVersion: true,
  create: false,
  packageInfo: { packageName: 'com.example.android', appName: xiaomiDetails.appName },
}

// Node 不支持 RSA_PKCS1 私钥解密时，用无填充解密检查加密块结构；只针对合成密钥。
function decodedSignature(
  raw: string,
  key: ReturnType<typeof xiaomiCredentials>['pair']['privateKey'],
): unknown {
  const data = Buffer.from(raw, 'hex'),
    parts: Buffer[] = []
  for (let i = 0; i < data.length; i += 256) {
    const block = privateDecrypt(
      { key, padding: constants.RSA_NO_PADDING },
      data.subarray(i, i + 256),
    )
    assert.equal(block[0], 0)
    assert.equal(block[1], 2)
    const separator = block.indexOf(0, 2)
    assert.ok(separator >= 10)
    parts.push(block.subarray(separator + 1))
  }
  return JSON.parse(Buffer.concat(parts).toString('utf8'))
}

test('小米材料页面通道安全保存、目录与本机核对兼容，拒绝旧测试格式及错误公钥', async (t) => {
  const f = await materialFixture(t)
  assert.equal(await f.repository.check('synthetic-xiaomi', 'xiaomi'), true)
  assert.equal((await f.repository.catalog()).profiles[0]?.channel, 'xiaomi')
  const disk = await readFile(f.vault, 'utf8')
  for (const secret of [
    f.credentials.privateKey,
    'synthetic-login-secret',
    f.credentials.publicKey,
  ])
    assert.ok(!disk.includes(secret))
  for (const patch of [
    { publicKey: 'not-rsa' },
    { testAccountJson: '{"zh_CN":"old"}' },
    { testAccountJson: '{"zh_CN":{"auditNotes":"","accounts":[]}}' },
    { userName: 'not-email' },
    { unexpected: 'secret' },
  ])
    assert.throws(() =>
      validateCredentialSubmission('xiaomi', {
        displayName: '测试',
        credentials: { ...f.credentials, ...patch },
      }),
    )
  const intake = new TestCredentialIntake(f.root, ['http://127.0.0.1:5178'], f.repository)
  await intake.start()
  t.after(() => intake.close())
  const session = await intake.session('xiaomi', 'http://127.0.0.1:5178')
  const response = await fetch(`${session.endpoint}/v1/sessions/${session.id}/profile`, {
    method: 'POST',
    headers: {
      origin: 'http://127.0.0.1:5178',
      authorization: `Bearer ${session.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ displayName: '页面小米', credentials: f.credentials }),
  })
  assert.equal(response.status, 202)
  for (let n = 0; n < 100; n++) {
    if ((await intake.operation(session.operationId))?.status !== 'saving') break
    await delay(5)
  }
  assert.equal((await intake.operation(session.operationId))?.status, 'saved')
  const catalog = await intake.accounts()
  assert.ok(
    catalog.accounts.some(
      (a) => a.reference === session.reference && a.configured && a.channel === 'xiaomi',
    ),
  )
  const encoded = JSON.stringify(catalog)
  assert.ok(!encoded.includes(f.credentials.privateKey))
  assert.ok(!encoded.includes('synthetic-login-secret'))
})

test('小米只读 POST 签名绑定包名、邮箱与 RequestData，不发送测试材料，严格检查更新许可', async (t) => {
  const f = await materialFixture(t)
  let calls = 0
  const transport: typeof fetch = async (url, init) => {
    calls++
    assert.equal(String(url), 'https://api.developer.xiaomi.com/devupload/dev/query')
    assert.equal(init?.method, 'POST')
    assert.equal(init?.redirect, 'error')
    assert.ok(init?.body instanceof FormData)
    const request = String(init.body.get('RequestData'))
    assert.deepEqual(JSON.parse(request), {
      userName: f.credentials.userName,
      packageName: 'com.example.android',
    })
    assert.ok(!request.includes('synthetic-login'))
    assert.deepEqual(decodedSignature(String(init.body.get('SIG')), f.pair.privateKey), {
      sig: [{ name: 'RequestData', hash: createHash('md5').update(request).digest('hex') }],
      password: f.credentials.privateKey,
    })
    return json(matched)
  }
  const input = {
    channel: 'xiaomi' as const,
    reference: 'synthetic-xiaomi',
    identifier: 'com.example.android',
    appId: 'com.example.android',
  }
  assert.deepEqual(await checkMerchant(input, f.store, transport), {
    code: 'verified',
    authentication: 'passed',
    target: 'passed',
  })
  assert.equal(calls, 1)
  for (const [body, code] of [
    [{ ...matched, updateVersion: false }, 'application_not_ready'],
    [{ result: 0, packageInfo: matched.packageInfo }, 'invalid_response'],
    [{ ...matched, updateVersion: 'true' }, 'invalid_response'],
    [{ ...matched, create: true }, 'invalid_response'],
    [{ ...matched, packageInfo: { packageName: 'com.other.app' } }, 'application_mismatch'],
    [{ result: 0, updateVersion: true }, 'application_not_found'],
    [{ result: -20014 }, 'invalid_credentials'],
    [{ result: -7 }, 'application_mismatch'],
  ] as const)
    assert.equal((await checkMerchant(input, f.store, async () => json(body))).code, code)
  assert.equal(
    (await checkMerchant(input, f.store, async () => new Response('invalid'))).code,
    'invalid_response',
  )
  assert.equal(
    (
      await checkMerchant(input, f.store, async () => {
        throw new Error('synthetic-network')
      })
    ).code,
    'network_unavailable',
  )
  assert.equal(
    (await checkMerchant({ ...input, appId: '123' }, f.store, transport)).code,
    'application_mismatch',
  )
  assert.equal(calls, 1, '无效目标不能调用商店')
})

async function xiaomiPlan(t: test.TestContext, executor?: Parameters<typeof setup>[2]) {
  const f = await setup(t, 'android', executor, { channel: 'xiaomi' })
  const plan = await f.plans.freeze(...f.args, {
    ...f.input,
    action: 'xiaomi_submit_review',
    xiaomi: xiaomiDetails,
    releasePolicy: { mode: 'after_approval' },
  })
  return { f, plan }
}

test('小米自动准备冻结真实动作与图标，源／资料／版本拒绝且一次确认并发只派发一次', async (t) => {
  let runs = 0
  const { f } = await xiaomiPlan(t, {
    async run(p, _id, permit) {
      runs++
      assert.equal(p.snapshot.action, 'xiaomi_submit_review')
      await permit()
      return 'review_submitted'
    },
    close() {},
  })
  const input = {
    requestId: randomUUID(),
    bindingId: f.binding.id,
    artifactId: f.artifact.id,
    expectedBindingRevision: 1,
    expectedArtifactSha256: f.artifact.sha256,
    releaseNotes: '小米更新说明',
    xiaomi: xiaomiDetails,
    releasePolicy: { mode: 'after_approval' },
  }
  const base = f.base.replace('release-plans', 'release-preparations')
  assert.equal(
    (
      await f.api.inject({
        method: 'POST',
        url: base,
        headers: { host: '127.0.0.1' },
        payload: input,
      })
    ).statusCode,
    403,
  )
  for (const patch of [
    { xiaomi: { ...xiaomiDetails, iconSha256: '0'.repeat(64) } },
    { xiaomi: { ...xiaomiDetails, privacyUrl: 'http://example.com' } },
    { expectedBindingRevision: 2 },
  ])
    await assert.rejects(f.preparations.start(...f.args, { ...input, ...patch }))
  assert.equal(
    (await f.api.inject({ method: 'POST', url: base, headers: f.headers, payload: input }))
      .statusCode,
    202,
  )
  for (let n = 0; n < 200; n++) {
    if ((await f.preparations.list(...f.args))[0]?.status === 'ready') break
    await delay(10)
  }
  const ready = (await f.preparations.list(...f.args))[0]
  assert.equal(ready?.status, 'ready')
  const p = (await f.store.list(...f.args)).find((p) => p.id === ready.planId)
  assert.ok(p)
  assert.equal(p.authorization, null)
  assert.ok(isReleasePlan(p) && planFingerprintsMatch(p))
  assert.deepEqual(p.snapshot.xiaomi, xiaomiDetails)
  const attempts = await Promise.all(
    Array.from({ length: 3 }, () =>
      f.execution.start(...f.args, p.id, { expectedDigest: p.digest, acknowledged: true }, true),
    ),
  )
  assert.equal(new Set(attempts.map((a) => a.id)).size, 1)
  const end = await terminal(f)
  assert.ok(isReleaseAttempt(end))
  assert.equal(end.code, 'review_submitted')
  assert.equal(runs, 1)
  // 成功回执不得由新计划绕过同一安装包的重复送审保护。
  const next = await f.plans.freeze(...f.args, {
    ...f.input,
    requestId: randomUUID(),
    action: 'xiaomi_submit_review',
    xiaomi: xiaomiDetails,
    releasePolicy: { mode: 'after_approval' },
  })
  await assert.rejects(
    f.execution.start(
      ...f.args,
      next.id,
      { expectedDigest: next.digest, acknowledged: true },
      true,
    ),
    /已确认受理/,
  )
  await assert.rejects(
    f.catalog.updateBinding(...f.args, f.binding.id, {
      appId: 'com.wrong.app',
      credentialReference: f.binding.credentialReference,
      expectedRevision: 1,
    }),
    /目标必须/,
  )
})

test('单次更新提交携带 APK／图标 MD5 与新版测试材料，许可失败零写入，许可后超时不重试', async (t) => {
  const material = await materialFixture(t),
    { f, plan } = await xiaomiPlan(t)
  const confirmed: ReleasePlan = {
    ...plan,
    status: 'confirmed',
    authorization: {
      id: randomUUID(),
      planDigest: plan.digest,
      scope: 'local_once',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    },
  }
  confirmed.snapshot.binding.credentialReference = 'synthetic-xiaomi'
  confirmed.snapshot.preflight.profileRevision = await profileRevision(material.vault)
  const file = join(f.root, 'artifacts', f.artifact.id, 'payload.apk')
  let writes = 0,
    permits = 0
  const transport: typeof fetch = async (url, init) => {
    if (String(url).endsWith('/query')) return json(matched)
    assert.equal(String(url), 'https://api.developer.xiaomi.com/devupload/dev/push')
    writes++
    assert.equal(permits, 1)
    assert.equal(init?.redirect, 'error')
    assert.ok(init?.body instanceof FormData)
    const body = init.body,
      request = String(body.get('RequestData')),
      data = JSON.parse(request)
    assert.equal(data.synchroType, 1)
    assert.equal(data.appInfo.privacyUrl, xiaomiDetails.privacyUrl)
    assert.deepEqual(
      JSON.parse(data.appInfo.testAccount),
      JSON.parse(material.credentials.testAccountJson),
    )
    const apk = body.get('apk'),
      icon = body.get('icon')
    assert.ok(apk instanceof Blob && icon instanceof Blob)
    const a = Buffer.from(await apk.arrayBuffer()),
      i = Buffer.from(await icon.arrayBuffer())
    assert.deepEqual(a, await readFile(file))
    assert.deepEqual(i, xiaomiIcon)
    assert.deepEqual(decodedSignature(String(body.get('SIG')), material.pair.privateKey), {
      sig: [
        { name: 'RequestData', hash: createHash('md5').update(request).digest('hex') },
        { name: 'apk', hash: createHash('md5').update(a).digest('hex') },
        { name: 'icon', hash: createHash('md5').update(i).digest('hex') },
      ],
      password: material.credentials.privateKey,
    })
    return json({ result: 0 })
  }
  await assert.rejects(
    submitXiaomiUpdate(
      confirmed,
      file,
      material.vault,
      async () => {
        throw new Error('拒绝许可')
      },
      material.store,
      transport,
    ),
  )
  assert.equal(writes, 0)
  assert.equal(
    await submitXiaomiUpdate(
      confirmed,
      file,
      material.vault,
      async () => {
        permits++
      },
      material.store,
      transport,
    ),
    'review_submitted',
  )
  assert.equal(writes, 1)
  let deniedPermits = 0
  assert.equal(
    await submitXiaomiUpdate(
      confirmed,
      file,
      material.vault,
      async () => {
        deniedPermits++
      },
      material.store,
      async () => json({ ...matched, packageInfo: { ...matched.packageInfo, appName: '已改名' } }),
    ),
    'verification_failed',
  )
  assert.equal(deniedPermits, 0, '名称变化不能取得远端许可')
  const changedFile = join(f.root, 'changed.apk')
  await writeFile(changedFile, 'changed-bytes')
  assert.equal(
    await submitXiaomiUpdate(
      confirmed,
      changedFile,
      material.vault,
      async () => {
        deniedPermits++
      },
      material.store,
      async () => json(matched),
    ),
    'verification_failed',
  )
  assert.equal(deniedPermits, 0, '实际字节变化不能取得许可')
  let timeoutWrites = 0
  assert.equal(
    await submitXiaomiUpdate(
      confirmed,
      file,
      material.vault,
      async () => {},
      material.store,
      async (url) => {
        if (String(url).endsWith('/query')) return json(matched)
        timeoutWrites++
        throw new Error('timeout')
      },
    ),
    'needs_reconciliation',
  )
  assert.equal(timeoutWrites, 1)
  const bad = structuredClone(confirmed)
  assert.ok(bad.snapshot.xiaomi)
  bad.snapshot.xiaomi.iconSha256 = '0'.repeat(64)
  await assert.rejects(
    submitXiaomiUpdate(
      bad,
      file,
      material.vault,
      async () => {
        throw new Error('不应许可')
      },
      material.store,
      transport,
    ),
  )
  assert.equal(writes, 1)
  assert.throws(() => validateXiaomiUpdateDetails({ ...xiaomiDetails, iconBase64: 'bad' }))
})

test('小米未知结果阻塞重复提交，人工结论按审核语义校验，不能使用华为草稿结论', async (t) => {
  const { f, plan } = await xiaomiPlan(t, {
    async run(_p, _id, permit) {
      await permit()
      return 'needs_reconciliation'
    },
    close() {},
  })
  await f.execution.start(
    ...f.args,
    plan.id,
    { expectedDigest: plan.digest, acknowledged: true },
    true,
  )
  const attempt = await terminal(f)
  const input = {
    expectedDigest: plan.digest,
    versionName: '1.2.3',
    buildNumber: '42',
    acknowledged: true,
  }
  await assert.rejects(
    f.execution.reconcile(...f.args, attempt.id, { ...input, decision: 'draft_present' }),
    /渠道动作/,
  )
  const next = await f.plans.freeze(...f.args, {
    ...f.input,
    requestId: randomUUID(),
    action: 'xiaomi_submit_review',
    xiaomi: xiaomiDetails,
    releasePolicy: { mode: 'after_approval' },
  })
  await assert.rejects(
    f.execution.start(
      ...f.args,
      next.id,
      { expectedDigest: next.digest, acknowledged: true },
      true,
    ),
    /待核对/,
  )
  const checked = await f.execution.reconcile(...f.args, attempt.id, {
    ...input,
    decision: 'submission_present',
  })
  assert.equal(checked.reconciliation?.decision, 'submission_present')
  assert.equal(checked.status, 'needs_reconciliation')
  await assert.rejects(
    f.execution.start(
      ...f.args,
      next.id,
      { expectedDigest: next.digest, acknowledged: true },
      true,
    ),
    /已确认受理/,
  )
})

// 旧快照不补字段、不改指纹；新动作及材料用版本 5 保存，降级前必须恢复旧备份。
test('版本四计划读取保持旧指纹，新增小米记录后明确升级为当前版本十六', async (t) => {
  const f = await setup(t, 'android')
  const old = await f.plans.freeze(...f.args, f.input)
  const disk = JSON.parse(await readFile(f.file, 'utf8'))
  disk.schemaVersion = 4
  delete disk.batches
  delete disk.appleReviews
  await writeFile(f.file, JSON.stringify(disk))
  assert.equal((await f.store.list(...f.args))[0]?.digest, old.digest)
  await f.plans.confirm(...f.args, old.id, { expectedDigest: old.digest, acknowledged: true })
  const upgraded = JSON.parse(await readFile(f.file, 'utf8'))
  assert.equal(upgraded.schemaVersion, 16)
  assert.deepEqual(upgraded.plans[0].snapshot, old.snapshot)
})
