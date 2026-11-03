/** @description 账号维护与故障恢复验收，使用实际 SDK 加密及内存秘密，不访问个人 Keychain 或商店。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { TestCredentialIntake, MemoryCredentialSecrets } from './fixtures/credential-intake.ts'
import { localCredentialRepository } from '../packages/provider-app-ship/src/index.ts'
import { CredentialAccountsService } from '../apps/api/src/credential-accounts.service.ts'
import { FileProjectStore } from '../apps/api/src/project-store.ts'
import { FileApplicationStore } from '../apps/api/src/application-store.ts'
import { ApplicationCatalog, ProjectCatalog } from '../packages/domain/src/index.ts'
import { createApp } from '../apps/api/src/app.ts'
import { CredentialIntakeEngine } from '../packages/runner-local/src/credential-intake-engine.ts'
import { CredentialAccountStore } from '../packages/runner-local/src/credential-account-store.ts'

const origin = 'http://127.0.0.1:5178'
const draft = {
  displayName: '可修复账号',
  credentials: { clientId: 'synthetic-client', clientSecret: 'synthetic-secret' },
}

async function fixture(t: test.TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'harbor-management-')))
  const secrets = new MemoryCredentialSecrets()
  const repository = localCredentialRepository(join(root, 'credentials/profiles.json'), secrets)
  const intake = new TestCredentialIntake(root, [origin], repository)
  await intake.start()
  t.after(async () => {
    await intake.close()
    await rm(root, { recursive: true, force: true })
  })
  return { root, secrets, repository, intake }
}

async function finished(intake: TestCredentialIntake, id: string) {
  for (let i = 0; i < 150; i++) {
    const operation = await intake.operation(id)
    if (operation && operation.status !== 'saving') return operation
    await delay(10)
  }
  throw new Error('保存超时')
}

async function account(intake: TestCredentialIntake, reference: string) {
  const item = (await intake.accounts()).accounts.find((a) => a.reference === reference)
  assert.ok(item)
  return item
}

async function create(intake: TestCredentialIntake, name = draft.displayName) {
  const session = await intake.session('huawei', origin)
  await intake.engine.save(session.id, { ...draft, displayName: name })
  assert.equal((await finished(intake, session.operationId)).status, 'saved')
  return account(intake, session.reference)
}

function target(a: Awaited<ReturnType<typeof account>>) {
  return { reference: a.reference, expectedRevision: a.managementRevision }
}

test('待核对账号可读回修复；材料缺失不冒充通过，重新录入保持引用并使旧能力失效', async (t) => {
  const { root, intake, secrets } = await fixture(t)
  const original = await create(intake)
  const initialVaultRevision = original.revision
  const stored = secrets.values.get(original.reference)
  assert.ok(stored)
  secrets.values.delete(original.reference)
  assert.deepEqual(await intake.manage({ ...target(original), action: 'recheck' }), {
    code: 'needs_input',
  })
  const missing = await account(intake, original.reference)
  assert.equal(missing.configured, false)
  assert.equal(missing.needsReconciliation, true)
  secrets.values.set(original.reference, stored)
  assert.deepEqual(await intake.manage({ ...target(missing), action: 'recheck' }), {
    code: 'checked',
  })
  const restored = await account(intake, original.reference)
  assert.equal(restored.configured, true)
  const staleSession = await intake.session('huawei', origin, target(restored))
  await intake.manage({ ...target(restored), action: 'rename', displayName: '修复后名称' })
  await assert.rejects(intake.engine.save(staleSession.id, draft), { statusCode: 409 })
  const renamed = await account(intake, original.reference)
  const replacement = await intake.session('huawei', origin, target(renamed))
  assert.equal(replacement.reference, original.reference)
  await intake.engine.save(replacement.id, {
    displayName: renamed.displayName,
    credentials: { clientId: 'synthetic-new-client', clientSecret: 'synthetic-new-secret' },
  })
  assert.equal((await finished(intake, replacement.operationId)).status, 'saved')
  const updated = await account(intake, original.reference)
  assert.equal(updated.configured, true)
  assert.notEqual(updated.revision, initialVaultRevision)
  assert.equal((await intake.accounts()).accounts.length, 1)
  assert.equal(
    JSON.parse(secrets.values.get(original.reference) ?? '{}').clientSecret,
    'synthetic-new-secret',
  )
  const metadata = await readFile(join(root, 'credential-accounts.json'), 'utf8')
  assert.ok(!metadata.includes('synthetic-new-secret'))
})

test('没有 SDK 元数据的历史失败记录可重新录入、编辑和删除，同渠道名称冲突不覆盖', async (t) => {
  const { root, intake } = await fixture(t)
  const session = await intake.session('huawei', origin)
  await intake.store.save({
    id: session.operationId,
    reference: session.reference,
    channel: 'huawei',
    displayName: '历史失败账号',
    status: 'saving',
    code: 'saving',
    createdAt: new Date().toISOString(),
  })
  await intake.store.save({
    id: session.operationId,
    reference: session.reference,
    channel: 'huawei',
    displayName: '历史失败账号',
    status: 'needs_reconciliation',
    code: 'needs_reconciliation',
    createdAt: (await intake.operation(session.operationId))!.createdAt,
  })
  const incomplete = await account(intake, session.reference)
  assert.equal(
    (await intake.manage({ ...target(incomplete), action: 'recheck' })).code,
    'needs_input',
  )
  const current = await account(intake, session.reference)
  const repair = await intake.session('huawei', origin, target(current))
  await intake.engine.save(repair.id, { ...draft, displayName: current.displayName })
  assert.equal((await finished(intake, repair.operationId)).status, 'saved')
  const other = await create(intake, '另一账号')
  const repaired = await account(intake, session.reference)
  await assert.rejects(
    intake.manage({ ...target(repaired), action: 'rename', displayName: other.displayName }),
  )
  assert.equal((await account(intake, repaired.reference)).displayName, '历史失败账号')
  assert.deepEqual(await intake.manage({ ...target(repaired), action: 'delete' }), {
    code: 'deleted',
  })
  assert.equal(
    (await intake.accounts()).accounts.some((a) => a.reference === repaired.reference),
    false,
  )
  assert.equal(
    (await intake.repository.catalog()).profiles.some((p) => p.reference === repaired.reference),
    false,
  )
  const store = new CredentialAccountStore(join(root, 'credential-accounts.json'))
  assert.equal((await store.list()).length, 1)
})

test('绑定账号删除由控制面拒绝；来源、额外材料及陈旧版本不进入管理，名称可正常修改', async (t) => {
  const { root, intake } = await fixture(t)
  const projects = new FileProjectStore(join(root, 'projects.json'))
  const applications = new FileApplicationStore(join(root, 'applications.json'))
  const service = new CredentialAccountsService(
    {
      start: async () => {},
      close: async () => {},
      accounts: () => intake.accounts(),
      session: (channel, source, replacement) => intake.session(channel, source, replacement),
      operation: (id) => intake.operation(id),
      manage: (input) => intake.manage(input),
    },
    [origin],
    projects,
    applications,
  )
  const app = await createApp(projects, {
    applicationStore: applications,
    credentialAccounts: service,
  })
  t.after(() => app.close())
  const original = await create(intake)
  const headers = { origin, 'x-release-harbor-setup': '1' }
  const request = (payload: Record<string, unknown>, source = headers) =>
    app.inject({
      method: 'POST',
      url: '/api/credential-account-actions',
      headers: source,
      payload,
    })
  assert.equal(
    (
      await request(
        { ...target(original), action: 'recheck' },
        { origin, 'x-release-harbor-setup': '' },
      )
    ).statusCode,
    403,
  )
  assert.equal(
    (
      await request({
        ...target(original),
        action: 'delete',
        clientSecret: 'synthetic-should-be-rejected',
      })
    ).statusCode,
    400,
  )
  const project = await new ProjectCatalog(projects).create('local', {
    name: '绑定项目',
    key: 'management',
    framework: 'native',
  })
  const catalog = new ApplicationCatalog(projects, applications)
  const application = await catalog.create('local', project.id, {
    name: '应用',
    platform: 'android',
    identifier: 'com.example.management',
  })
  await catalog.bind('local', project.id, application.id, {
    channel: 'huawei',
    appId: '123',
    credentialReference: original.reference,
  })
  assert.equal((await request({ ...target(original), action: 'delete' })).statusCode, 409)
  assert.equal((await account(intake, original.reference)).configured, true)
  assert.equal(
    (await request({ ...target(original), action: 'rename', displayName: '新名称' })).statusCode,
    200,
  )
  assert.equal((await request({ ...target(original), action: 'recheck' })).statusCode, 409)
  const current = await account(intake, original.reference)
  assert.equal(
    (await request({ ...target(current), action: 'recheck' })).json().result.code,
    'checked',
  )
  assert.equal((await service.catalog()).accounts[0]?.applicationCount, 1)
})

test('进程中断后的 saving 档案一律待核对，元数据存在不能代替读回材料', async (t) => {
  const { root, intake } = await fixture(t)
  const original = await create(intake)
  const file = join(root, 'credential-accounts.json')
  const record = (await intake.store.list())[0]!
  await writeFile(
    file,
    JSON.stringify({
      schemaVersion: 1,
      operations: [{ ...record, status: 'saving', code: 'saving' }],
    }),
  )
  const recovered = new CredentialIntakeEngine(new CredentialAccountStore(file), intake.repository)
  await recovered.initialize()
  const quarantined = (await recovered.accounts()).accounts[0]!
  assert.equal(quarantined.configured, false)
  assert.equal(quarantined.needsReconciliation, true)
  assert.equal(
    (await recovered.manage({ ...target(quarantined), action: 'recheck' })).code,
    'checked',
  )
  assert.equal(quarantined.reference, original.reference)
})

test('模拟存储截断时写后核对拒绝保存成功，失败不回显材料', async (t) => {
  const { root } = await fixture(t)
  const secrets = new MemoryCredentialSecrets()
  secrets.setSecret = async (ref, value) => {
    secrets.values.set(ref, value.slice(0, 100))
  }
  const repository = localCredentialRepository(join(root, 'truncated/profiles.json'), secrets)
  await assert.rejects(
    repository.save('truncated-test', 'huawei', {
      fields: { clientId: 'synthetic'.repeat(20), clientSecret: 'synthetic'.repeat(100) },
    }),
  )
})

test('删除故障后保留隔离记录，重试需要刷新版本；不因系统失败丢失标签', async (t) => {
  const { root, intake } = await fixture(t)
  const original = await create(intake)
  const failing = new CredentialIntakeEngine(intake.store, {
    ...intake.repository,
    async delete() {
      throw new Error('不对外暴露的系统错误')
    },
  })
  await assert.rejects(failing.manage({ ...target(original), action: 'delete' }), {
    statusCode: 503,
  })
  const record = (await intake.store.list())[0]!
  assert.equal(record.status, 'needs_reconciliation')
  assert.equal((await account(intake, original.reference)).configured, false)
  assert.ok(!(await readFile(join(root, 'credential-accounts.json'), 'utf8')).includes('系统错误'))
  const pending = await account(intake, original.reference)
  assert.equal((await intake.manage({ ...target(pending), action: 'delete' })).code, 'deleted')
})
