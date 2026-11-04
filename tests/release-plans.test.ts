/** @description 冻结、确认、并发取消和依赖失效的端到端测试；合成字节与受控预检端口，不读取真实账号或请求商店。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  isRecord,
  isReleasePlan,
  isReleasePlanView,
  type ReleasePlan,
} from '../packages/contracts/src/index.ts'
import {
  notesFingerprint,
  planFingerprint,
  validateReleasePlanInput,
} from '../packages/domain/src/index.ts'
import { FileReleasePlanStore } from '../apps/api/src/release-plan-store.ts'
import { ReleaseExecutionService } from '../apps/api/src/release-execution.service.ts'
import { setup, confirmed, terminal } from './fixtures/release-plans.ts'

test('冻结只使用服务端事实，重复请求去重；响应和重启保留不可变指纹', async (t) => {
  const f = await setup(t)
  const response = await f.api.inject({
    method: 'POST',
    url: f.base,
    headers: f.headers,
    payload: f.input,
  })
  assert.equal(response.statusCode, 201, response.body)
  const plan: ReleasePlan = response.json().plan
  assert.ok(isReleasePlan(plan))
  assert.equal(plan.status, 'frozen')
  assert.equal(plan.authorization, null)
  assert.equal(plan.digest, planFingerprint(plan.snapshot))
  assert.equal(plan.snapshot.notesDigest, notesFingerprint(f.input.releaseNotes))
  assert.equal(plan.snapshot.artifact.sha256, f.artifact.sha256)
  const duplicate = await f.plans.freeze(...f.args, f.input)
  assert.equal(duplicate.id, plan.id)
  await assert.rejects(
    f.plans.freeze(...f.args, { ...f.input, releaseNotes: '其他说明' }),
    /另一份计划/,
  )
  const disk = await new FileReleasePlanStore(f.file).list(...f.args)
  assert.deepEqual(disk, [plan])
  assert.ok(!JSON.stringify(plan).includes(f.root))
  assert.equal(f.calls(), 1, '冻结和查询不重复请求商店')
  const views = await f.plans.list(...f.args)
  assert.ok(isReleasePlanView(views[0]))
})

test('两种平台的动作严格匹配；未知字段、跨归属和无来源确认被拒绝', async (t) => {
  const f = await setup(t, 'android')
  await assert.rejects(
    f.plans.freeze(...f.args, { ...f.input, action: 'apple_upload_build' }),
    /不匹配/,
  )
  for (const input of [
    { ...f.input, workspaceId: 'other' },
    { ...f.input, action: 'submit_review' },
    { ...f.input, releaseNotes: ' ' },
    { ...f.input, releaseNotes: 'x\x00' },
  ])
    assert.throws(() => validateReleasePlanInput(input))
  const plan = await f.plans.freeze(...f.args, f.input)
  assert.equal(plan.snapshot.action, 'huawei_save_draft')
  const decision = { expectedDigest: plan.digest, acknowledged: true }
  for (const headers of [
    { host: '127.0.0.1' },
    { ...f.headers, origin: 'http://evil.example' },
    { ...f.headers, 'x-release-harbor-plan': '0' },
  ]) {
    assert.equal(
      (
        await f.api.inject({
          method: 'POST',
          url: f.base + '/' + plan.id + '/confirm',
          headers,
          payload: decision,
        })
      ).statusCode,
      403,
    )
  }
  assert.equal(
    (
      await f.api.inject({
        method: 'POST',
        url: f.base + '/' + plan.id + '/confirm',
        headers: f.headers,
        payload: { ...decision, acknowledged: false },
      })
    ).statusCode,
    400,
  )
  await assert.rejects(
    f.plans.confirm(...f.args, plan.id, { ...decision, expectedDigest: 'b'.repeat(64) }),
    /不一致/,
  )
  await assert.rejects(f.plans.confirm('other', f.args[1], f.args[2], plan.id, decision), /不存在/)
  await assert.rejects(f.plans.freeze('local', randomUUID(), f.args[2], f.input), /不存在/)
  assert.equal((await f.store.list(...f.args))[0]?.authorization, null)
})

test('并发确认只生成一次限定授权；取消撤销且重启不重新派发', async (t) => {
  const f = await setup(t)
  const plan = await f.plans.freeze(...f.args, f.input)
  const decision = { expectedDigest: plan.digest, acknowledged: true }
  const results = await Promise.all(
    Array.from({ length: 4 }, () => f.plans.confirm(...f.args, plan.id, decision)),
  )
  assert.equal(new Set(results.map((p) => p.authorization?.id)).size, 1)
  const confirmed = results[0]
  assert.ok(confirmed?.authorization)
  assert.equal(confirmed.authorization.planDigest, plan.digest)
  assert.equal(confirmed.authorization.scope, 'local_once')
  assert.ok(
    Date.parse(confirmed.authorization.expiresAt) <=
      Date.parse(plan.snapshot.preflight.expiresAt ?? ''),
  )
  f.advance(1000)
  const repeated = await f.plans.confirm(...f.args, plan.id, decision)
  assert.deepEqual(repeated.authorization, confirmed.authorization)
  const cancelled = await f.plans.cancel(...f.args, plan.id, { expectedDigest: plan.digest })
  assert.equal(cancelled.status, 'cancelled')
  assert.deepEqual(cancelled.snapshot, plan.snapshot)
  assert.equal((await f.plans.list(...f.args))[0]?.invalidatedBy, 'cancelled')
  await assert.rejects(f.plans.confirm(...f.args, plan.id, decision), /失效/)
  assert.deepEqual(
    await f.plans.cancel(...f.args, plan.id, { expectedDigest: plan.digest }),
    cancelled,
  )
  assert.equal((await new FileReleasePlanStore(f.file).list(...f.args))[0]?.status, 'cancelled')
  assert.equal(f.calls(), 1)
  assert.equal(
    (
      await f.api.inject({
        method: 'POST',
        url: f.base + '/' + plan.id + '/execute',
        headers: f.headers,
        payload: decision,
      })
    ).statusCode,
    409,
  )
})

test('实际产物字节变化使计划与确认失效，数据库摘要未变也不能继续确认', async (t) => {
  const f = await setup(t)
  const plan = await f.plans.freeze(...f.args, f.input)
  await f.plans.confirm(...f.args, plan.id, { expectedDigest: plan.digest, acknowledged: true })
  await writeFile(f.bytes.paths(f.artifact).payload, 'changed-synthetic-artifact')
  assert.equal((await f.plans.list(...f.args))[0]?.invalidatedBy, 'artifact_changed')
  await assert.rejects(
    f.plans.confirm(...f.args, plan.id, { expectedDigest: plan.digest, acknowledged: true }),
    /失效/,
  )
})

test('绑定、目录与有效期变化分别失效，不用旧通过结果替代新意图', async (t) => {
  const f = await setup(t)
  const plan = await f.plans.freeze(...f.args, f.input)
  const profile = f.profiles.profiles[0]
  assert.ok(profile)
  profile.revision = 'b'.repeat(64)
  assert.equal((await f.plans.list(...f.args))[0]?.invalidatedBy, 'profile_changed')
  f.profiles.code = 'storage_unavailable'
  f.profiles.profiles = []
  assert.equal((await f.plans.list(...f.args))[0]?.invalidatedBy, 'profile_unavailable')
  f.profiles.code = 'available'
  f.profiles.profiles = [{ ...profile, revision: 'a'.repeat(64) }]
  f.advance(301000)
  assert.equal((await f.plans.list(...f.args))[0]?.invalidatedBy, 'preflight_expired')
  await assert.rejects(f.plans.freeze(...f.args, { ...f.input, requestId: randomUUID() }), /未过期/)
  f.advance(-301000)
  await f.catalog.updateBinding(...f.args, f.binding.id, {
    appId: '654321',
    credentialReference: f.binding.credentialReference,
    expectedRevision: 1,
  })
  assert.equal((await f.plans.list(...f.args))[0]?.invalidatedBy, 'binding_changed')
  await assert.rejects(
    f.plans.confirm(...f.args, plan.id, { expectedDigest: plan.digest, acknowledged: true }),
    /失效/,
  )
})

test('取消与确认竞争不复活取消计划，损坏快照和文件均拒绝覆盖', async (t) => {
  const f = await setup(t)
  const plan = await f.plans.freeze(...f.args, f.input)
  const results = await Promise.allSettled([
    f.plans.cancel(...f.args, plan.id, { expectedDigest: plan.digest }),
    f.plans.confirm(...f.args, plan.id, { expectedDigest: plan.digest, acknowledged: true }),
  ])
  assert.equal(results[0]?.status, 'fulfilled')
  assert.equal(results[1]?.status, 'rejected')
  const original = await readFile(f.file, 'utf8')
  const tampered = original.replace('修复登录问题', '恶意改写说明')
  await writeFile(f.file, tampered)
  await assert.rejects(f.plans.list(...f.args), /无法读取/)
  await assert.rejects(
    f.plans.freeze(...f.args, { ...f.input, requestId: randomUUID() }),
    /无法读取/,
  )
  assert.equal(await readFile(f.file, 'utf8'), tampered)
  await writeFile(f.file, '{broken')
  await assert.rejects(f.store.list(...f.args), /无法读取/)
  assert.equal(await readFile(f.file, 'utf8'), '{broken')
})

test('一次性消费在并发、重复请求和重启后不再派发，成功安全回执可读取', async (t) => {
  let runs = 0
  const f = await setup(t, 'android', {
    async run(_p, _id, permit) {
      runs++
      await permit()
      return 'draft_saved'
    },
    close() {},
  })
  const p = await confirmed(f)
  const decision = { expectedDigest: p.digest, acknowledged: true }
  const results = await Promise.all(
    Array.from({ length: 5 }, () => f.execution.start(...f.args, p.id, decision)),
  )
  assert.equal(new Set(results.map((a) => a.id)).size, 1)
  assert.equal((await terminal(f)).status, 'succeeded')
  assert.equal(runs, 1)
  await assert.rejects(f.plans.cancel(...f.args, p.id, { expectedDigest: p.digest }), /已消费/)
  await assert.rejects(f.plans.confirm(...f.args, p.id, decision), /已消费/)
  const recovered = new ReleaseExecutionService(f.store, f.plans, {
    async run() {
      throw new Error('禁止重放')
    },
    close() {},
  })
  assert.equal((await recovered.start(...f.args, p.id, decision)).id, results[0]?.id)
  assert.ok(!JSON.stringify(await recovered.list(...f.args)).includes(f.root))
})

test('许可前后故障分别记录失败与待核对，未知结果阻止新计划绕过', async (t) => {
  const f = await setup(t, 'android', {
    async run(_p, _id, permit) {
      await permit()
      throw new Error('合成供应商秘密原文')
    },
    close() {},
  })
  const p = await confirmed(f)
  await f.execution.start(...f.args, p.id, { expectedDigest: p.digest, acknowledged: true })
  const a = await terminal(f)
  assert.equal(a.status, 'needs_reconciliation')
  assert.ok(!JSON.stringify(a).includes('供应商'))
  const second = await f.plans.freeze(...f.args, { ...f.input, requestId: randomUUID() })
  await f.plans.confirm(...f.args, second.id, { expectedDigest: second.digest, acknowledged: true })
  await assert.rejects(
    f.execution.start(...f.args, second.id, { expectedDigest: second.digest, acknowledged: true }),
    /待核对/,
  )
  const g = await setup(t, 'android')
  const q = await confirmed(g)
  await g.execution.start(...g.args, q.id, { expectedDigest: q.digest, acknowledged: true })
  assert.equal((await terminal(g)).status, 'failed')
})

test('执行前拒绝过期、Apple 缺口、跨归属、缺少来源和未知字段，均不消费', async (t) => {
  const f = await setup(t)
  const p = await confirmed(f)
  const body = { expectedDigest: p.digest, acknowledged: true }
  await assert.rejects(f.execution.start(...f.args, p.id, body), /Apple/)
  assert.equal((await f.execution.list(...f.args)).length, 0)
  assert.equal(
    (
      await f.api.inject({
        method: 'POST',
        url: f.base + '/' + p.id + '/execute',
        headers: { host: '127.0.0.1' },
        payload: body,
      })
    ).statusCode,
    403,
  )
  await assert.rejects(f.execution.start('other', f.args[1], f.args[2], p.id, body), /不存在/)
  await assert.rejects(f.execution.start(...f.args, p.id, { ...body, path: '/tmp/untrusted' }))
  const g = await setup(t, 'android')
  const q = await confirmed(g)
  g.advance(301000)
  await assert.rejects(
    g.execution.start(...g.args, q.id, { expectedDigest: q.digest, acknowledged: true }),
    /过期/,
  )
  assert.equal((await g.execution.list(...g.args)).length, 0)
})

test('执行准备期间配置变化使远端握手拒绝；全局单槽不消费第二份计划', async (t) => {
  let proceed: (() => void) | undefined
  const waiting = new Promise<void>((r) => {
    proceed = r
  })
  const f = await setup(t, 'android', {
    async run(_p, _id, permit) {
      await waiting
      await permit()
      return 'draft_saved'
    },
    close() {
      proceed?.()
    },
  })
  const p = await confirmed(f)
  await f.execution.start(...f.args, p.id, { expectedDigest: p.digest, acknowledged: true })
  const q = await f.plans.freeze(...f.args, { ...f.input, requestId: randomUUID() })
  await f.plans.confirm(...f.args, q.id, { expectedDigest: q.digest, acknowledged: true })
  await assert.rejects(
    f.execution.start(...f.args, q.id, { expectedDigest: q.digest, acknowledged: true }),
    /进行中/,
  )
  await writeFile(f.bytes.paths(f.artifact).payload, 'changed')
  proceed?.()
  assert.equal((await terminal(f)).status, 'interrupted')
  assert.equal((await f.execution.list(...f.args))[0]?.remoteStartedAt, null)
})

test('版本一迁移保留快照；遗留执行仅恢复为中断或待核对，不重新调用执行器', async (t) => {
  for (const remote of [false, true]) {
    const f = await setup(t, 'android')
    const p = await confirmed(f)
    await writeFile(f.file, JSON.stringify({ schemaVersion: 1, plans: [p] }))
    assert.deepEqual((await f.store.list(...f.args))[0], p)
    const time = new Date().toISOString()
    await f.store.execution(async (_plans, attempts) => {
      attempts.push({
        id: randomUUID(),
        planId: p.id,
        authorizationId: p.authorization?.id ?? '',
        planDigest: p.digest,
        status: remote ? 'running' : 'preparing',
        code: remote ? 'running' : 'preparing',
        createdAt: time,
        remoteStartedAt: remote ? time : null,
        finishedAt: null,
      })
    })
    const recovered = new ReleaseExecutionService(f.store, f.plans, {
      async run() {
        throw new Error('禁止重放')
      },
      close() {},
    })
    assert.equal(
      (await recovered.list(...f.args))[0]?.status,
      remote ? 'needs_reconciliation' : 'interrupted',
    )
    assert.equal(JSON.parse(await readFile(f.file, 'utf8')).schemaVersion, 4)
  }
})

test('真实固定 worker 拒绝被篡改的快照，不访问凭据或请求远端许可', async (t) => {
  const { LocalReleaseExecutor } = await import('../packages/runner-local/src/index.ts')
  const f = await setup(t, 'android')
  const p = await confirmed(f)
  const executor = new LocalReleaseExecutor(
    join(f.root, 'artifacts'),
    join(f.root, 'credentials/profiles.json'),
  )
  t.after(() => executor.close())
  const tampered = structuredClone(p)
  tampered.snapshot.releaseNotes = '篡改说明'
  const diagnostics: string[] = []
  let permitted = false
  assert.equal(
    await executor.run(
      tampered,
      randomUUID(),
      async () => {
        permitted = true
      },
      (code) => diagnostics.push(code),
    ),
    'verification_failed',
  )
  assert.equal(permitted, false)
  assert.deepEqual(diagnostics, ['plan_invalid'])
})

test('实际 SDK 核对合成 APK 并解析内存凭据，许可先于唯一上传，草稿参数和回执投影正确', async (t) => {
  const { UploadManager } = await import(
    '../packages/provider-app-ship/node_modules/@huoye/app-ship/dist/index.js'
  )
  const { credentialStore, profileRevision } = await import(
    '../packages/provider-app-ship/src/credentials.ts'
  )
  const { saveHuaweiDraft } = await import('../packages/provider-app-ship/src/release-execution.ts')
  const { MemoryCredentialSecrets } = await import('./fixtures/credential-intake.ts')
  const { syntheticApk } = await import('./fixtures/apk.ts')
  const f = await setup(t, 'android')
  const p = await confirmed(f)
  const apk = await syntheticApk(f.root)
  assert.ok(apk, 'SDK 适配验收需要本机 aapt2')
  const file = join(f.root, 'synthetic-apk/synthetic.apk')
  const vault = join(f.root, 'credentials/profiles.json')
  const store = credentialStore(vault, new MemoryCredentialSecrets())
  await store.saveProfile({
    credentialProfile: p.snapshot.binding.credentialReference,
    platform: 'huawei',
    material: { fields: { clientId: 'synthetic-client', clientSecret: 'synthetic-secret' } },
  })
  p.snapshot.preflight.profileRevision = await profileRevision(vault)
  const sha256 = createHash('sha256').update(apk).digest('hex')
  Object.assign(p.snapshot.artifact, {
    sha256,
    sizeBytes: apk.length,
    identity: {
      format: 'apk',
      packageName: 'com.example.android',
      versionName: '0.1.0',
      buildNumber: '7',
      sha256,
      sizeBytes: apk.length,
    },
  })
  const manager = new UploadManager()
  let granted = false
  let calls = 0
  manager.registerUploader('huawei', {
    name: '合成上传端口',
    validateConfig() {
      return true
    },
    canHandle() {
      return true
    },
    async upload(_file, config: unknown) {
      calls++
      assert.equal(granted, true)
      assert.ok(
        isRecord(config) &&
          isRecord(config.retry) &&
          isRecord(config.publish) &&
          isRecord(config.publish.huawei),
      )
      assert.equal(config.retry.maxRetries, 0)
      assert.equal(config.publish.huawei.releaseType, 'draft')
      assert.equal(config.publish.huawei.appId, p.snapshot.binding.appId)
      return {
        platform: 'huawei',
        success: true,
        message: '合成 SDK 验收，不代表商店结果',
        data: { action: 'create_draft', status: 'draft' },
      }
    },
  })
  assert.equal(
    await saveHuaweiDraft(
      p,
      file,
      vault,
      async () => {
        granted = true
      },
      { credentialStore: store, uploadManager: manager },
    ),
    'draft_saved',
  )
  assert.equal(calls, 1)
  granted = false
  await assert.rejects(
    saveHuaweiDraft(
      p,
      file,
      vault,
      async () => {
        throw new Error('拒绝许可')
      },
      { credentialStore: store, uploadManager: manager },
    ),
  )
  assert.equal(calls, 1, '拒绝许可不得调用上传器')
})
