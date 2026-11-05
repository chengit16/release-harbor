/** @description Apple 合成 IPA、临时密钥和只读状态回归；注入工具及传输，绝不调用真实商店。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setup, confirmed, terminal } from './fixtures/release-plans.ts'
import { syntheticIpa } from './fixtures/ipa.ts'
import { MemoryCredentialSecrets } from './fixtures/credential-intake.ts'
import { credentialStore, profileRevision } from '../packages/provider-app-ship/src/credentials.ts'
import { inspectIpaArtifact } from '../packages/provider-app-ship/src/inspect-ipa.ts'
import {
  uploadAppleBuild,
  AppleToolUnavailableError,
} from '../packages/provider-app-ship/src/apple-upload.ts'
import { observeAppleBuild } from '../packages/provider-app-ship/src/apple-build-status.ts'

const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  .privateKey.export({ type: 'pkcs8', format: 'pem' })
  .toString()
const help = '--upload-package --api-key --api-issuer --p8-file-path --output-format'
const issuer = '11111111-1111-4111-8111-111111111111'

test('Apple 一次确认原子消费，匹配动作才承认成功；重复请求不再上传', async (t) => {
  const f = await setup(t, 'ios', {
    async run(_p, _id, permit) {
      await permit()
      return 'build_processing'
    },
    close() {},
  })
  const p = await f.plans.freeze(...f.args, f.input)
  const body = { expectedDigest: p.digest, acknowledged: true }
  await Promise.all([
    f.execution.start(...f.args, p.id, body, true),
    f.execution.start(...f.args, p.id, body, true),
  ])
  assert.equal((await terminal(f)).code, 'build_processing')
  assert.equal((await f.execution.list(...f.args)).length, 1)
})

test('Apple 工具、材料与许可门禁，P-256 受限落盘、结果查询及清理', async (t) => {
  const f = await setup(t)
  const p = await confirmed(f)
  const runtime = join(await realpath(f.root), 'runtime')
  await mkdir(runtime, { mode: 0o700 })
  const file = join(runtime, 'app.ipa')
  await writeFile(file, syntheticIpa(f.application.identifier, true))
  const vault = join(f.root, 'credentials', 'profiles.json')
  const store = credentialStore(vault, new MemoryCredentialSecrets())
  await store.saveProfile({
    credentialProfile: p.snapshot.binding.credentialReference,
    platform: 'app_store',
    material: {
      fields: { apiKeyId: 'ABC123DE45', apiIssuerId: issuer },
      files: { privateKey: { content: key } },
    },
  })
  p.snapshot.artifact.identity = await inspectIpaArtifact(file)
  p.snapshot.artifact.sha256 = p.snapshot.artifact.identity.sha256
  p.snapshot.artifact.sizeBytes = p.snapshot.artifact.identity.sizeBytes
  p.snapshot.preflight.profileRevision = await profileRevision(vault)
  let uploads = 0,
    permits = 0
  const transport: typeof fetch = async (input, init) => {
    assert.equal(new URL(String(input)).pathname, '/v1/builds')
    assert.equal(init?.method, 'GET')
    return Response.json({
      data: [
        {
          type: 'builds',
          id: '1',
          attributes: {
            version: p.snapshot.artifact.identity?.buildNumber,
            processingState: 'VALID',
          },
          relationships: { preReleaseVersion: { data: { id: 'v' } } },
        },
      ],
      included: [
        {
          type: 'preReleaseVersions',
          id: 'v',
          attributes: { version: p.snapshot.artifact.identity?.versionName, platform: 'IOS' },
        },
      ],
    })
  }
  const tool = async (args: readonly string[], env: NodeJS.ProcessEnv) => {
    assert.ok(!args.join(' ').includes('PRIVATE KEY'))
    if (args.includes('--help')) return { ok: true, stdout: help }
    uploads++
    assert.equal(permits, 1)
    const index = args.indexOf('--p8-file-path'),
      keyFile = args[index + 1]
    assert.ok(keyFile)
    assert.equal((await stat(keyFile)).mode & 0o777, 0o600)
    assert.equal(await readFile(keyFile, 'utf8'), key)
    assert.equal(env.HOME, runtime)
    return { ok: true, stdout: '' }
  }
  const permit = async () => {
    permits++
  }
  assert.equal(
    await uploadAppleBuild(p, file, vault, runtime, permit, { store, tool, transport }),
    'build_available',
  )
  assert.equal(uploads, 1)
  assert.deepEqual(await readdir(runtime), ['app.ipa'])
  await assert.rejects(
    uploadAppleBuild(p, file, vault, runtime, permit, {
      store,
      tool: async () => ({ ok: true, stdout: 'old' }),
    }),
    AppleToolUnavailableError,
  )
  assert.equal(uploads, 1)
  await assert.rejects(
    uploadAppleBuild(
      p,
      file,
      vault,
      runtime,
      async () => {
        throw Error('deny')
      },
      { store, tool, transport },
    ),
  )
  assert.deepEqual(await readdir(runtime), ['app.ipa'])
  assert.equal(uploads, 1)
})

test('Apple 处理结果严格匹配版本与构建，错误及不明不伪装构建可用', async (t) => {
  const f = await setup(t),
    p = await confirmed(f)
  for (const state of ['PROCESSING', 'VALID', 'FAILED', 'INVALID', 'unknown']) {
    const transport: typeof fetch = async () =>
      Response.json({
        data: [
          {
            type: 'builds',
            attributes: {
              version: p.snapshot.artifact.identity?.buildNumber,
              processingState: state,
            },
            relationships: { preReleaseVersion: { data: { id: 'v' } } },
          },
        ],
        included: [
          {
            id: 'v',
            type: 'preReleaseVersions',
            attributes: { version: p.snapshot.artifact.identity?.versionName, platform: 'IOS' },
          },
        ],
      })
    assert.equal(
      await observeAppleBuild(p, 'ABC123DE45', issuer, key, transport),
      state === 'VALID'
        ? 'build_available'
        : state === 'PROCESSING'
          ? 'build_processing'
          : ['FAILED', 'INVALID'].includes(state)
            ? 'processing_failed'
            : 'build_uploaded',
    )
  }
  for (const body of [
    { data: [] },
    { data: [{}, {}] },
    { data: [{ attributes: { processingState: 'VALID', version: 'wrong' } }] },
  ]) {
    assert.equal(
      await observeAppleBuild(p, 'ABC123DE45', issuer, key, async () => Response.json(body)),
      'build_uploaded',
    )
  }
  assert.equal(
    await observeAppleBuild(p, 'ABC123DE45', issuer, key, async () => {
      throw Error('private raw')
    }),
    'build_uploaded',
  )
})

test('Apple 完整独立 runner 复核二进制 IPA，目标失败零上传，许可后工具异常待核对', async (t) => {
  const { runRelease } = await import('../packages/runner-local/src/run-release.ts')
  const provider = await import('../packages/provider-app-ship/src/index.ts')
  const { configurationFingerprint, planFingerprint } = await import(
    '../packages/domain/src/release-plans.ts'
  )
  const f = await setup(t),
    p = await confirmed(f)
  const root = await realpath(join(f.root, 'artifacts'))
  const file = join(root, p.snapshot.artifact.id, 'payload.ipa')
  await writeFile(file, syntheticIpa(f.application.identifier, true))
  const identity = await inspectIpaArtifact(file)
  Object.assign(p.snapshot.artifact, {
    identity,
    sha256: identity.sha256,
    sizeBytes: identity.sizeBytes,
  })
  Object.assign(p.snapshot.preflight, { artifactSha256: identity.sha256 })
  const vault = join(f.root, 'credentials', 'profiles.json')
  const store = credentialStore(vault, new MemoryCredentialSecrets())
  await store.saveProfile({
    credentialProfile: p.snapshot.binding.credentialReference,
    platform: 'app_store',
    material: {
      fields: { apiKeyId: 'ABC123DE45', apiIssuerId: issuer },
      files: { privateKey: { content: key } },
    },
  })
  p.snapshot.preflight.profileRevision = await profileRevision(vault)
  p.snapshot.configDigest = configurationFingerprint(p.snapshot)
  p.digest = planFingerprint(p.snapshot)
  assert.ok(p.authorization)
  p.authorization.planDigest = p.digest
  const runtime = join(await realpath(f.root), 'runtime')
  await mkdir(runtime, { mode: 0o700 })
  let uploads = 0,
    permits = 0,
    matched = true
  const port = {
    ...provider,
    credentialStore: () => store,
    checkMerchant: async () =>
      ({
        code: matched ? 'verified' : 'application_mismatch',
        authentication: 'passed',
        target: matched ? 'passed' : 'unverified',
      }) as const,
    uploadAppleBuild: async (...args: Parameters<typeof uploadAppleBuild>) =>
      uploadAppleBuild(args[0], args[1], args[2], args[3], args[4], {
        store,
        tool: async (args) => {
          if (args.includes('--help')) return { ok: true, stdout: help }
          uploads++
          return { ok: false, stdout: '' }
        },
      }),
  }
  const task = {
    schemaVersion: 1,
    nonce: 'a'.repeat(32),
    attemptId: p.id,
    plan: p,
    storageRoot: root,
    vaultPath: vault,
    runtimeRoot: runtime,
  } as const
  assert.equal(
    await runRelease(
      task,
      async () => {
        permits++
      },
      undefined,
      port,
    ),
    'needs_reconciliation',
  )
  assert.equal(uploads, 1)
  assert.equal(permits, 1)
  assert.deepEqual(await readdir(runtime), [])
  matched = false
  assert.equal(
    await runRelease(
      task,
      async () => {
        permits++
      },
      undefined,
      port,
    ),
    'verification_failed',
  )
  assert.equal(uploads, 1)
  assert.equal(permits, 1)
})

test('Apple 未知结果使用构建结论核对，旧草稿结论不可用且相同包不重传', async (t) => {
  const f = await setup(t, 'ios', {
    async run(_p, _id, permit) {
      await permit()
      return 'draft_saved'
    },
    close() {},
  })
  const p = await confirmed(f)
  await f.execution.start(...f.args, p.id, { expectedDigest: p.digest, acknowledged: true })
  const attempt = await terminal(f)
  assert.equal(attempt.status, 'needs_reconciliation')
  const input = {
    expectedDigest: p.digest,
    versionName: p.snapshot.artifact.identity?.versionName,
    buildNumber: p.snapshot.artifact.identity?.buildNumber,
    acknowledged: true,
  }
  await assert.rejects(
    f.execution.reconcile(...f.args, attempt.id, { ...input, decision: 'draft_present' }),
    /不匹配/,
  )
  await f.execution.reconcile(...f.args, attempt.id, { ...input, decision: 'build_present' })
  const next = await f.plans.freeze(...f.args, { ...f.input, requestId: crypto.randomUUID() })
  await assert.rejects(
    f.execution.start(
      ...f.args,
      next.id,
      { expectedDigest: next.digest, acknowledged: true },
      true,
    ),
    /已确认受理|待核对/,
  )
  assert.equal((await f.execution.list(...f.args)).length, 1)
})

test('iOS 只接受自动或手动发布，拒绝新增定时和 Android 手动意图', async (t) => {
  const { planFingerprint, configurationFingerprint } = await import(
    '../packages/domain/src/release-plans.ts'
  )
  const f = await setup(t, 'ios')
  const p = await f.plans.freeze(...f.args, { ...f.input, releasePolicy: { mode: 'manual' } })
  assert.deepEqual(p.snapshot.releasePolicy, { mode: 'manual' })
  await assert.rejects(
    f.plans.freeze(...f.args, {
      ...f.input,
      requestId: crypto.randomUUID(),
      releasePolicy: { mode: 'scheduled', notBefore: new Date(Date.now() + 60000).toISOString() },
    }),
  )
  const g = await setup(t, 'android')
  await assert.rejects(g.plans.freeze(...g.args, { ...g.input, releasePolicy: { mode: 'manual' } }))
  // 历史定时快照继续可读，但不能因恢复 Apple 上传而静默执行旧意图。
  const old = await f.plans.confirm(...f.args, p.id, {
    expectedDigest: p.digest,
    acknowledged: true,
  })
  old.snapshot.releasePolicy = {
    mode: 'scheduled',
    notBefore: new Date(Date.now() + 60000).toISOString(),
  }
  old.snapshot.configDigest = configurationFingerprint(old.snapshot)
  old.digest = planFingerprint(old.snapshot)
  assert.ok(old.authorization)
  old.authorization.planDigest = old.digest
  const { runRelease } = await import('../packages/runner-local/src/run-release.ts')
  let permitted = false
  assert.equal(
    await runRelease(
      {
        schemaVersion: 1,
        nonce: 'a'.repeat(32),
        attemptId: old.id,
        plan: old,
        storageRoot: f.root,
        vaultPath: f.root,
      },
      async () => {
        permitted = true
      },
    ),
    'verification_failed',
  )
  assert.equal(permitted, false)
})
