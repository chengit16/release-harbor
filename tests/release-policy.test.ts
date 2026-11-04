/** @description 上架策略、公开资料自动复用及渠道执行边界；使用隔离存储和拦截网络，不查询或提交真实用户应用。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import {
  isReleasePolicy,
  type ReleasePolicy,
  type ReleasePlan,
} from '../packages/contracts/src/index.ts'
import { validateReleasePolicy } from '../packages/domain/src/index.ts'
import {
  checkMerchant,
  credentialStore,
  localCredentialRepository,
  profileRevision,
  validateCredentialSubmission,
  submitXiaomiUpdate,
  loadXiaomiListing,
} from '../packages/provider-app-ship/src/index.ts'
import { MemoryCredentialSecrets } from './fixtures/credential-intake.ts'
import { xiaomiCredentials, xiaomiDetails, xiaomiIcon } from './fixtures/xiaomi.ts'
import { setup } from './fixtures/release-plans.ts'

const listing = `<div class="app-info"><img class="yellow-flower" src="http://file.market.xiaomi.com/thumbnail/PNG/l114/AppStore/123abcdef" alt="小米测试应用"><div class="intro-titles"><h3 style="color:black">小米测试应用</h3></div></div><div>隐私政策</div><div><a href="https://example.com/privacy?lang=zh&amp;source=store">点击查看</a></div><div>包名</div><div class="line-break">com.example.android</div>`
const matched = {
  result: 0,
  create: false,
  updateVersion: true,
  packageInfo: { packageName: 'com.example.android', appName: xiaomiDetails.appName },
}
const json = (value: unknown): Response => new Response(JSON.stringify(value))
async function material(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'harbor-policy-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const vault = join(root, 'credentials/profiles.json'),
    secrets = new MemoryCredentialSecrets()
  const credentials = xiaomiCredentials().credentials
  const { material } = validateCredentialSubmission('xiaomi', {
    displayName: '策略测试',
    credentials,
  })
  await localCredentialRepository(vault, secrets).save('synthetic-plan-account', 'xiaomi', material)
  return { root, vault, store: credentialStore(vault, secrets), credentials }
}
async function prepared(f: Awaited<ReturnType<typeof setup>>) {
  for (let n = 0; n < 200; n++) {
    const result = (await f.preparations.list(...f.args))[0]
    if (result?.status !== 'checking' && result) return result
    await delay(10)
  }
  throw new Error('准备未结束')
}
function intent(f: Awaited<ReturnType<typeof setup>>, policy: ReleasePolicy) {
  return {
    requestId: randomUUID(),
    bindingId: f.binding.id,
    artifactId: f.artifact.id,
    expectedBindingRevision: 1,
    expectedArtifactSha256: f.artifact.sha256,
    releaseNotes: '策略验收',
    releasePolicy: policy,
  }
}

test('上架策略严格限制 UTC、类型、未来时间及多余字段，历史过去时间仍可读取', () => {
  const future = { mode: 'scheduled', notBefore: new Date(Date.now() + 86400000).toISOString() }
  assert.ok(isReleasePolicy(future))
  assert.deepEqual(validateReleasePolicy(future), future)
  const old = { mode: 'scheduled', notBefore: '2020-01-01T00:00:00.000Z' }
  assert.ok(isReleasePolicy(old))
  assert.throws(() => validateReleasePolicy(old), /已到或已过期/)
  for (const value of [
    { mode: 'manual' },
    { mode: 'scheduled' },
    { mode: 'after_approval', notBefore: future.notBefore },
    { ...future, notBefore: '2030-01-01 12:00:00' },
    { ...future, notBefore: '2030-01-01T12:00:00+08:00' },
    { ...future, notBefore: '2030-02-31T00:00:00.000Z' },
    { ...future, token: 'unexpected' },
  ]) {
    assert.equal(isReleasePolicy(value), false)
    assert.throws(() => validateReleasePolicy(value))
  }
})

test('只读准备自动复用官方公开资料，包名和名称一致才固定原图、隐私政策及来源', async (t) => {
  const f = await material(t),
    seen: string[] = []
  const transport: typeof fetch = async (url, init) => {
    const href = String(url)
    seen.push(href)
    assert.equal(init?.redirect, 'error')
    if (href.endsWith('/query')) return json(matched)
    assert.equal(init?.method, 'GET')
    assert.equal(init?.headers, undefined, '公开站点不能收到鉴权头')
    assert.equal(init?.body, undefined, '公开站点不能收到材料')
    if (href === 'https://app.mi.com/details?id=com.example.android') return new Response(listing)
    assert.equal(href, 'https://file.market.xiaomi.com/download/AppStore/123abcdef')
    return new Response(xiaomiIcon)
  }
  const result = await checkMerchant(
    {
      channel: 'xiaomi',
      reference: 'synthetic-plan-account',
      identifier: 'com.example.android',
      appId: 'com.example.android',
    },
    f.store,
    transport,
    true,
  )
  assert.equal(result.code, 'verified')
  assert.ok(result.xiaomi)
  assert.equal(result.xiaomi.appName, xiaomiDetails.appName)
  assert.equal(result.xiaomi.privacyUrl, 'https://example.com/privacy?lang=zh&source=store')
  assert.equal(result.xiaomi.iconSha256, xiaomiDetails.iconSha256)
  assert.deepEqual(Buffer.from(result.xiaomi.iconBase64, 'base64'), xiaomiIcon)
  assert.equal(result.xiaomi.source?.url, 'https://app.mi.com/details?id=com.example.android')
  assert.equal(seen.length, 3)
  assert.ok(!JSON.stringify(result).includes(f.credentials.privateKey))
})

test('公开资料不完整、身份不符或图标来源越界时停止，不访问任意网址或回填占位内容', async (t) => {
  for (const html of [
    listing.replace('com.example.android', 'com.other.app'),
    listing.replace('<h3 style="color:black">小米测试应用', '<h3 style="color:black">别名'),
    listing.replace('隐私政策', '没有政策'),
    listing.replace('file.market.xiaomi.com', 'evil.example.com'),
    listing.replace('https://example.com/privacy', 'javascript:bad'),
  ]) {
    let calls = 0
    await assert.rejects(
      loadXiaomiListing('com.example.android', xiaomiDetails.appName, async (url) => {
        calls++
        return String(url).startsWith('https://app.mi.com/')
          ? new Response(html)
          : new Response(xiaomiIcon)
      }),
    )
    assert.ok(calls <= 2)
  }
  await assert.rejects(
    loadXiaomiListing(
      'com.example.android',
      xiaomiDetails.appName,
      async () => new Response('x'.repeat(512 * 1024 + 1)),
    ),
  )
  await assert.rejects(
    loadXiaomiListing('com.example.android', xiaomiDetails.appName, async (url) =>
      String(url).startsWith('https://app.mi.com/')
        ? new Response(listing)
        : new Response('not-png'),
    ),
  )
  const f = await material(t)
  const failed = await checkMerchant(
    {
      channel: 'xiaomi',
      reference: 'synthetic-plan-account',
      identifier: 'com.example.android',
      appId: 'com.example.android',
    },
    f.store,
    async (url) =>
      String(url).endsWith('/query') ? json(matched) : new Response('changed-layout'),
    true,
  )
  assert.equal(failed.code, 'store_materials_unavailable')
  assert.equal(failed.xiaomi, undefined)
})

test('小米不用再提交三项资料，策略及自动资料随准备冻结，修改时间不能复用原请求', async (t) => {
  const f = await setup(t, 'android', undefined, { channel: 'xiaomi' })
  const policy: ReleasePolicy = {
    mode: 'scheduled',
    notBefore: new Date(Date.now() + 86400000).toISOString(),
  }
  const body = intent(f, policy)
  await f.preparations.start(...f.args, body)
  const ready = await prepared(f)
  assert.equal(ready.status, 'ready')
  const p = (await f.store.list(...f.args))[0]
  assert.ok(p)
  assert.deepEqual(p.snapshot.xiaomi, xiaomiDetails)
  assert.deepEqual(p.snapshot.releasePolicy, policy)
  assert.equal(p.authorization, null)
  assert.equal((await f.preparations.list(...f.args))[0]?.input.xiaomi, undefined)
  const { releasePolicy: _policy, ...legacyInput } = f.input
  const old = await f.plans.freeze(...f.args, { ...legacyInput, requestId: randomUUID() })
  assert.equal(old.snapshot.releasePolicy, undefined)
  await assert.rejects(
    f.execution.start(...f.args, old.id, { expectedDigest: old.digest, acknowledged: true }, true),
    /旧计划未记录/,
  )
  assert.equal((await f.store.list(...f.args)).find((p) => p.id === old.id)?.authorization, null)
  await assert.rejects(
    f.preparations.start(...f.args, { ...body, releasePolicy: { mode: 'after_approval' } }),
    /另一份发布准备/,
  )
  const changed = await f.plans.freeze(...f.args, {
    ...f.input,
    requestId: randomUUID(),
    releasePolicy: { mode: 'after_approval' },
  })
  assert.notEqual(changed.digest, p.digest)
  assert.deepEqual(changed.snapshot.xiaomi, xiaomiDetails)
  const forged = {
    ...xiaomiDetails,
    source: {
      kind: 'xiaomi_public_listing',
      url: 'https://app.mi.com/details?id=com.example.android',
      checkedAt: new Date().toISOString(),
    },
  }
  await assert.rejects(
    f.preparations.start(...f.args, { ...body, requestId: randomUUID(), xiaomi: forged }),
    /来源仅能/,
  )
})

test('Android／iOS 均可记录策略，过期时间阻止消费；Apple 不因选上架类型开放执行', async (t) => {
  for (const platform of ['android', 'ios'] as const) {
    const f = await setup(t, platform)
    const policy: ReleasePolicy = {
      mode: 'scheduled',
      notBefore: new Date(Date.now() + 30000).toISOString(),
    }
    await f.preparations.start(...f.args, intent(f, policy))
    assert.equal((await prepared(f)).status, 'ready')
    const plan = (await f.store.list(...f.args))[0]
    assert.ok(plan)
    assert.deepEqual(plan.snapshot.releasePolicy, policy)
    if (platform === 'ios') {
      await assert.rejects(
        f.execution.start(
          ...f.args,
          plan.id,
          { expectedDigest: plan.digest, acknowledged: true },
          true,
        ),
        /Apple/,
      )
      assert.equal((await f.store.list(...f.args))[0]?.authorization, null)
    }
    f.advance(31000)
    assert.equal(
      (await f.plans.list(...f.args)).find((v) => v.plan.id === plan.id)?.invalidatedBy,
      'release_time_elapsed',
    )
    await assert.rejects(
      f.plans.confirm(...f.args, plan.id, { expectedDigest: plan.digest, acknowledged: true }),
      /失效/,
    )
    assert.equal((await f.execution.list(...f.args)).length, 0)
  }
})

test('小米定时发送精确 onlineTime，立即模式省略；许可等待跨过时间后不降级或提交', async (t) => {
  const f = await setup(t, 'android', undefined, { channel: 'xiaomi' }),
    m = await material(t)
  const plan = await f.plans.freeze(...f.args, f.input)
  const confirmed = await f.plans.confirm(...f.args, plan.id, {
    expectedDigest: plan.digest,
    acknowledged: true,
  })
  const copy: ReleasePlan = structuredClone(confirmed)
  copy.snapshot.preflight.profileRevision = await profileRevision(m.vault)
  const file = join(f.root, 'artifacts', f.artifact.id, 'payload.apk')
  for (const policy of [
    { mode: 'after_approval' },
    { mode: 'scheduled', notBefore: new Date(Date.now() + 86400000).toISOString() },
  ] as const) {
    copy.snapshot.releasePolicy = policy
    let writes = 0,
      permits = 0
    const result = await submitXiaomiUpdate(
      copy,
      file,
      m.vault,
      async () => {
        permits++
      },
      m.store,
      async (url, init) => {
        if (String(url).endsWith('/query')) return json(matched)
        writes++
        assert.equal(permits, 1)
        assert.ok(init?.body instanceof FormData)
        const body = JSON.parse(String(init.body.get('RequestData')))
        assert.equal(
          body.appInfo.onlineTime,
          policy.mode === 'scheduled' ? Date.parse(policy.notBefore) : undefined,
        )
        return json({ result: 0 })
      },
    )
    assert.equal(result, 'review_submitted')
    assert.equal(writes, 1)
  }
  const now = Date.now()
  let current = now,
    writes = 0
  t.mock.method(Date, 'now', () => current)
  copy.snapshot.releasePolicy = { mode: 'scheduled', notBefore: new Date(now + 1000).toISOString() }
  const result = await submitXiaomiUpdate(
    copy,
    file,
    m.vault,
    async () => {
      current = now + 2000
    },
    m.store,
    async (url) => {
      if (String(url).endsWith('/query')) return json(matched)
      writes++
      return json({ result: 0 })
    },
  )
  assert.equal(result, 'needs_reconciliation')
  assert.equal(writes, 0)
  const legacy = structuredClone(copy)
  delete legacy.snapshot.releasePolicy
  assert.equal(
    await submitXiaomiUpdate(
      legacy,
      file,
      m.vault,
      async () => {},
      m.store,
      async () => {
        throw new Error('旧计划不应发请求')
      },
    ),
    'verification_failed',
  )
})
