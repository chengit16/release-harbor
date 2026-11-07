/** @description 应用宝与鸿蒙完整执行及字节、策略、未知结果验证，网络仅使用固定替身。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, writeFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fixture, network, resign } from './fixtures/tencent-harmony-execution.ts'
import { syntheticHarmony } from './fixtures/harmony.ts'
import {
  checkMerchant,
  submitTencentUpdate,
  submitHarmonyUpdate,
  inspectLocalArtifact,
  saveHuaweiDraft,
  submitXiaomiUpdate,
  submitOppoUpdate,
  submitVivoUpdate,
  submitMeizuUpdate,
  submitHonorUpdate,
} from '../packages/provider-app-ship/src/index.ts'
import type { ExecutionDiagnostic } from '../packages/contracts/src/index.ts'
import { isPreflightTask } from '../packages/runner-local/src/preflight-protocol.ts'
import { runRelease } from '../packages/runner-local/src/run-release.ts'
test('应用宝真实单包签名、原始 PUT、递增与立即／定时提交，不重放旧字段', async (t) => {
  const f = await fixture(t, 'tencent')
  for (const mode of ['after_approval', 'scheduled'] as const) {
    f.plan.snapshot.releasePolicy =
      mode === 'scheduled'
        ? { mode, notBefore: new Date(Date.now() + 86400000).toISOString() }
        : { mode }
    resign(f.plan)
    const n = network(f)
    let permits = 0
    const outcome = await submitTencentUpdate(
      f.plan,
      f.file,
      f.vault,
      async () => {
        permits++
        n.permit()
      },
      f.credentials,
      { transport: n.transport },
    )
    assert.equal(outcome, 'tencent_review_submitted')
    assert.equal(permits, 1)
    assert.equal(n.writes, 3)
    const body = n.calls.find((c) => c.path.endsWith('/update_app'))?.body
    assert.ok(body)
    assert.equal(body.deploy_type, mode === 'scheduled' ? '2' : '1')
    assert.equal(body.apk32_flag, '1')
    assert.equal(body.apk64_flag, '2')
    assert.equal(body.apk32_file_serial_number, 'synthetic-new-upload')
    assert.ok(!('app_name' in body))
    assert.ok(!('login_account' in body))
    assert.ok(!JSON.stringify(body).includes('STALE-SERIAL'))
    if (mode === 'scheduled')
      assert.equal(
        body.deploy_time,
        String(
          Math.ceil(
            Date.parse(
              f.plan.snapshot.releasePolicy.mode === 'scheduled'
                ? f.plan.snapshot.releasePolicy.notBefore
                : '',
            ) / 1000,
          ),
        ),
      )
  }
})

test('应用宝查询失败／来源变化先于写许可；签名地址或提交丢失保持未知且不重试', async (t) => {
  const f = await fixture(t, 'tencent')
  for (const options of [
    { rejectQuery: true },
    { sourceChanged: true },
    { badUrl: true },
    { submitLost: true },
  ]) {
    const n = network(f, options),
      diagnostics: ExecutionDiagnostic[] = []
    let permits = 0
    const result = await submitTencentUpdate(
      f.plan,
      f.file,
      f.vault,
      async () => {
        permits++
        n.permit()
      },
      f.credentials,
      { transport: n.transport, report: (c) => diagnostics.push(c) },
    )
    assert.equal(
      result,
      options.rejectQuery || options.sourceChanged ? 'verification_failed' : 'needs_reconciliation',
    )
    assert.equal(permits, options.rejectQuery || options.sourceChanged ? 0 : 1)
    assert.ok(n.calls.filter((c) => c.path.endsWith('/update_app')).length <= 1)
    assert.ok(!JSON.stringify(diagnostics).includes('SENSITIVE'))
  }
})

test('鸿蒙完整分片／合并／解析／包身份／说明读回／两分钟等待及真实上架策略', async (t) => {
  const f = await fixture(t, 'harmony')
  for (const scheduled of [false, true]) {
    f.plan.snapshot.releasePolicy = scheduled
      ? { mode: 'scheduled', notBefore: new Date(Date.now() + 86400000).toISOString() }
      : { mode: 'after_approval' }
    resign(f.plan)
    const n = network(f),
      pauses: number[] = []
    let permits = 0
    assert.equal(
      await submitHarmonyUpdate(
        f.plan,
        f.file,
        f.vault,
        async () => {
          permits++
          n.permit()
        },
        f.credentials,
        {
          transport: n.transport,
          clock: () => 0,
          pause: async (ms) => {
            pauses.push(ms)
          },
        },
      ),
      'harmony_review_submitted',
    )
    assert.equal(permits, 1)
    assert.deepEqual(pauses, [120000])
    assert.equal(n.calls.filter((c) => c.path.endsWith('/app-submit')).length, 1)
    const body = n.calls.find((c) => c.path.endsWith('/app-submit'))?.body
    assert.equal(body?.releaseType, 1)
    assert.equal(body?.releasePhase, 0)
    assert.equal(
      body?.releaseTime,
      scheduled && f.plan.snapshot.releasePolicy.mode === 'scheduled'
        ? new Date(Math.ceil(Date.parse(f.plan.snapshot.releasePolicy.notBefore) / 1000) * 1000)
            .toISOString()
            .replace(/\.\d{3}Z$/, '+0000')
        : '2000-01-01T00:00:00+0000',
    )
  }
})

test('鸿蒙解析中／失败、软件包不符、说明未写入或结果丢失均不得误报送审，不重试', async (t) => {
  const f = await fixture(t, 'harmony')
  for (const options of [
    { parse: 1 },
    { parse: 2 },
    { wrongPackage: true },
    { wrongNotes: true },
    { badUrl: true },
    { submitLost: true },
  ]) {
    const n = network(f, options),
      diagnostics: ExecutionDiagnostic[] = []
    assert.equal(
      await submitHarmonyUpdate(f.plan, f.file, f.vault, async () => n.permit(), f.credentials, {
        transport: n.transport,
        pause: async () => {},
        clock: () => 0,
        report: (c) => diagnostics.push(c),
      }),
      'needs_reconciliation',
    )
    assert.equal(
      n.calls.filter((c) => c.path.endsWith('/app-submit')).length,
      options.submitLost ? 1 : 0,
    )
    assert.ok(diagnostics.length > 0)
    assert.ok(!JSON.stringify(diagnostics).includes('SENSITIVE'))
    if (options.parse === 1) assert.equal(diagnostics.at(-1), 'harmony_package_parsing')
    if (options.parse === 2) assert.equal(diagnostics.at(-1), 'harmony_package_failed')
  }
})

test('正式 APP 真实身份拒绝缺少字段、调试结构、错误包名与非递增版本', async (t) => {
  const f = await fixture(t, 'harmony')
  assert.equal((await inspectLocalArtifact(f.file)).format, 'app')
  for (const pack of [
    {},
    { summary: { app: { bundleName: 'com.example.invalid', version: { name: '1', code: 0 } } } },
    { app: { bundleName: 'com.example.hap' } },
  ]) {
    await writeFile(f.file, syntheticHarmony(f.application.identifier, pack))
    await assert.rejects(() => inspectLocalArtifact(f.file))
  }
  await assert.rejects(() =>
    f.catalog.bind('local', f.application.projectId, f.application.id, {
      channel: 'huawei',
      appId: '123456',
      credentialReference: f.binding.credentialReference,
    }),
  )
  const task = {
    schemaVersion: 1,
    action: 'preflight',
    nonce: 'a'.repeat(32),
    vaultPath: f.vault,
    channel: 'tencent',
    appId: '123456',
    reference: f.binding.credentialReference,
    profileRevision: 'a'.repeat(64),
    inspection: {
      schemaVersion: 1,
      action: 'inspect',
      nonce: 'a'.repeat(32),
      artifactId: f.artifact.id,
      storageRoot: await realpath(join(f.root, 'artifacts')),
      format: 'app',
      sizeBytes: 1,
      sha256: 'a'.repeat(64),
      target: {
        workspaceId: 'local',
        projectId: f.application.projectId,
        applicationId: f.application.id,
        identifier: f.application.identifier,
        platform: 'harmony',
      },
    },
  }
  assert.equal(isPreflightTask(task), false)
})

test('两家渠道通过完整独立 runRelease 副本复核和许可，产物或来源变化不会上传', async (t) => {
  for (const channel of ['tencent', 'harmony'] as const) {
    const f = await fixture(t, channel),
      n = network(f),
      task = {
        schemaVersion: 1 as const,
        attemptId: randomUUID(),
        nonce: 'a'.repeat(32),
        plan: f.plan,
        vaultPath: f.vault,
        storageRoot: await realpath(join(f.root, 'artifacts')),
      }
    let permits = 0
    const provider = {
      credentialStore: () => f.credentials,
      checkMerchant,
      saveHuaweiDraft,
      submitXiaomiUpdate,
      submitOppoUpdate,
      submitVivoUpdate,
      submitMeizuUpdate,
      submitHonorUpdate,
      submitTencentUpdate: (...args: Parameters<typeof submitTencentUpdate>) =>
        submitTencentUpdate(args[0], args[1], args[2], args[3], args[4], {
          transport: n.transport,
        }),
      submitHarmonyUpdate: (...args: Parameters<typeof submitHarmonyUpdate>) =>
        submitHarmonyUpdate(args[0], args[1], args[2], args[3], args[4], {
          transport: n.transport,
          pause: async () => {},
          clock: () => 0,
        }),
    }
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
      channel === 'tencent' ? 'tencent_review_submitted' : 'harmony_review_submitted',
    )
    assert.equal(permits, 1)
    await writeFile(f.file, Buffer.from('tampered'))
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
  }
})

test('应用宝纯 64 位单包不伪造通用包字段，鸿蒙真实多分片逐片长度与合并回执匹配', async (t) => {
  const apk = await fixture(t, 'tencent'),
    lib = join(apk.root, 'lib/arm64-v8a')
  await mkdir(lib, { recursive: true })
  await writeFile(join(lib, 'libsynthetic.so'), 'synthetic-native-content')
  await promisify(execFile)('/usr/bin/zip', ['-q', apk.file, 'lib/arm64-v8a/libsynthetic.so'], {
    cwd: apk.root,
    timeout: 15000,
  })
  const identity = await inspectLocalArtifact(apk.file)
  Object.assign(apk.plan.snapshot.artifact, {
    sha256: identity.sha256,
    sizeBytes: identity.sizeBytes,
    expectedSizeBytes: identity.sizeBytes,
    identity,
  })
  apk.plan.snapshot.preflight.artifactSha256 = identity.sha256
  resign(apk.plan)
  const n = network(apk)
  assert.equal(
    await submitTencentUpdate(
      apk.plan,
      apk.file,
      apk.vault,
      async () => n.permit(),
      apk.credentials,
      { transport: n.transport },
    ),
    'tencent_review_submitted',
  )
  const body = n.calls.find((c) => c.path.endsWith('/update_app'))?.body
  assert.equal(body?.apk64_flag, '1')
  assert.equal(body?.apk32_flag, '2')
  assert.equal(body?.apk64_file_serial_number, 'synthetic-new-upload')
  assert.ok(!Object.hasOwn(body ?? {}, 'apk32_file_serial_number'))
  const app = await fixture(t, 'harmony'),
    bytes = syntheticHarmony(app.application.identifier, undefined, 6 * 1024 * 1024)
  await writeFile(app.file, bytes)
  const info = await inspectLocalArtifact(app.file)
  Object.assign(app.plan.snapshot.artifact, {
    sha256: info.sha256,
    sizeBytes: info.sizeBytes,
    expectedSizeBytes: info.sizeBytes,
    identity: info,
  })
  app.plan.snapshot.preflight.artifactSha256 = info.sha256
  resign(app.plan)
  const h = network(app)
  assert.equal(
    await submitHarmonyUpdate(
      app.plan,
      app.file,
      app.vault,
      async () => h.permit(),
      app.credentials,
      { transport: h.transport, pause: async () => {}, clock: () => 0 },
    ),
    'harmony_review_submitted',
  )
  assert.equal(h.calls.filter((c) => c.method === 'PUT' && c.path === '/payload').length, 2)
})

test('许可前确认过期零写入，鸿蒙等待中定时过期不降级成立即也不送审', async (t) => {
  const f = await fixture(t, 'harmony'),
    auth = f.plan.authorization
  assert.ok(auth)
  const expiry = auth.expiresAt
  auth.expiresAt = new Date(Date.now() - 1).toISOString()
  const n = network(f)
  let permits = 0
  assert.equal(
    await submitHarmonyUpdate(
      f.plan,
      f.file,
      f.vault,
      async () => {
        permits++
        n.permit()
      },
      f.credentials,
      { transport: n.transport },
    ),
    'verification_failed',
  )
  assert.equal(permits, 0)
  assert.equal(n.writes, 0)
  auth.expiresAt = expiry
  f.plan.snapshot.releasePolicy = {
    mode: 'scheduled',
    notBefore: new Date(Date.now() + 60000).toISOString(),
  }
  resign(f.plan)
  const h = network(f)
  assert.equal(
    await submitHarmonyUpdate(f.plan, f.file, f.vault, async () => h.permit(), f.credentials, {
      transport: h.transport,
      pause: async () => {
        f.plan.snapshot.releasePolicy = {
          mode: 'scheduled',
          notBefore: new Date(Date.now() - 1).toISOString(),
        }
      },
      clock: () => 0,
    }),
    'needs_reconciliation',
  )
  assert.equal(h.calls.filter((c) => c.path.endsWith('/app-submit')).length, 0)
})
