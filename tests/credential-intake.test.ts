/** @description 本机配置闭环验收，来源／会话先于材料，重复请求、故障和恢复均使用合成数据。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { request as httpRequest } from 'node:http'
import {
  isCredentialAccounts,
  isCredentialOperation,
  type CredentialOperation,
} from '../packages/contracts/src/index.ts'
import {
  validateCredentialSubmission,
  type CredentialRepository,
} from '../packages/provider-app-ship/src/index.ts'
import { LocalCredentialIntake } from '../packages/runner-local/src/index.ts'
import { isCredentialSetupSession } from '../packages/runner-local/src/credential-session-protocol.ts'
import { CredentialIntakeEngine } from '../packages/runner-local/src/credential-intake-engine.ts'
import { CredentialAccountStore } from '../packages/runner-local/src/credential-account-store.ts'
import { TestCredentialIntake } from './fixtures/credential-intake.ts'
import { createApp } from '../apps/api/src/app.ts'
import { FileProjectStore } from '../apps/api/src/project-store.ts'
import { FileApplicationStore } from '../apps/api/src/application-store.ts'
import { CredentialAccountsService } from '../apps/api/src/credential-accounts.service.ts'
import { ApplicationCatalog, ProjectCatalog } from '../packages/domain/src/index.ts'

const origin = 'http://127.0.0.1:5178'
const syntheticSecret = 'synthetic-' + 'secret-marker'
const huawei = {
  displayName: '合成华为账号',
  credentials: { clientId: 'synthetic-client', clientSecret: syntheticSecret },
}

async function fixture(t: test.TestContext, repository?: CredentialRepository, now?: () => number) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'harbor-intake-test-')))
  const intake = new TestCredentialIntake(root, [origin], repository, now)
  await intake.start()
  t.after(async () => {
    await intake.close()
    await rm(root, { recursive: true, force: true })
  })
  return { root, intake }
}

async function finished(intake: TestCredentialIntake, id: string): Promise<CredentialOperation> {
  for (let i = 0; i < 150; i++) {
    const result = await intake.operation(id)
    if (result && result.status !== 'saving') return result
    await delay(10)
  }
  throw new Error('保存未进入末态')
}

async function filesBelow(root: string): Promise<string[]> {
  const files: string[] = []
  for (const item of await readdir(root, { withFileTypes: true })) {
    const path = join(root, item.name)
    files.push(...(item.isDirectory() ? await filesBelow(path) : [await readFile(path, 'utf8')]))
  }
  return files
}

test('真实回环 HTTP 保存华为及 Apple 合成凭据，回报和磁盘均不含秘密，旧 CLI 档案可选择', async (t) => {
  const { root, intake } = await fixture(t)
  const session = await intake.session('huawei', origin)
  assert.ok(isCredentialSetupSession(session))
  const response = await fetch(`${session.endpoint}/v1/sessions/${session.id}/profile`, {
    method: 'POST',
    headers: {
      origin,
      Authorization: `Bearer ${session.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(huawei),
  })
  assert.equal(response.status, 202)
  assert.equal(response.headers.get('access-control-allow-origin'), origin)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.ok(!JSON.stringify(await response.json()).includes(syntheticSecret))
  assert.equal((await finished(intake, session.operationId)).status, 'saved')
  const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    .privateKey.export({ format: 'pem', type: 'pkcs8' })
    .toString()
  const apple = await intake.session('app_store', origin)
  await intake.engine.save(apple.id, {
    displayName: '合成 Apple 账号',
    credentials: {
      apiIssuerId: '11111111-1111-4111-8111-111111111111',
      apiKeyId: 'ABCDEFGHIJ',
      privateKey: key,
    },
  })
  assert.equal((await finished(intake, apple.operationId)).status, 'saved')
  await intake.repository.save('legacy-profile', 'huawei', {
    fields: { clientId: 'synthetic-id', clientSecret: syntheticSecret },
  })
  const catalog = await intake.accounts()
  assert.ok(isCredentialAccounts(catalog))
  assert.equal(catalog.accounts.length, 3)
  assert.equal(catalog.accounts.find((a) => a.reference === 'legacy-profile')?.legacy, true)
  assert.equal(
    catalog.accounts.find((a) => a.reference === session.reference)?.displayName,
    huawei.displayName,
  )
  for (const disk of await filesBelow(root)) {
    assert.ok(!disk.includes(syntheticSecret))
    assert.ok(!disk.includes(key))
    assert.ok(!disk.includes(session.token))
    assert.ok(!disk.includes('synthetic-client'))
  }
})

test('来源、Host、会话及大小在材料保存前拒绝，错误不回显秘密', async (t) => {
  const { intake } = await fixture(t)
  const session = await intake.session('huawei', origin)
  const url = `${session.endpoint}/v1/sessions/${session.id}/profile`
  const valid = {
    origin,
    Authorization: `Bearer ${session.token}`,
    'Content-Type': 'application/json',
  }
  for (const headers of [
    { ...valid, origin: 'https://evil.example' },
    { ...valid, origin: 'null' },
    { Authorization: valid.Authorization, 'Content-Type': 'application/json' },
    { ...valid, Authorization: 'Bearer wrong' },
  ]) {
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(huawei) })
    assert.equal(response.status, 403)
    assert.ok(!(await response.text()).includes(syntheticSecret))
  }
  // fetch 会规范化 Host；直接 HTTP 请求才能验证线上实际收到的伪造 Host。
  const wrongHost = await new Promise<number>((resolve, reject) => {
    const request = httpRequest(
      url,
      { method: 'POST', headers: { ...valid, host: 'localhost:1' } },
      (response) => {
        response.resume()
        resolve(response.statusCode ?? 0)
      },
    )
    request.on('error', reject)
    request.end(JSON.stringify(huawei))
  })
  assert.equal(wrongHost, 403)
  for (const body of [
    { ...huawei, reference: 'injected' },
    { ...huawei, credentials: { ...huawei.credentials, privateKey: 'injected' } },
  ]) {
    assert.equal(
      (await fetch(url, { method: 'POST', headers: valid, body: JSON.stringify(body) })).status,
      400,
    )
  }
  assert.equal(
    (
      await fetch(url, {
        method: 'POST',
        headers: valid,
        body: JSON.stringify({ ...huawei, extra: 'x'.repeat(130 * 1024) }),
      })
    ).status,
    413,
  )
  assert.equal(await intake.operation(session.operationId), null)
  const preflight = await fetch(url, {
    method: 'OPTIONS',
    headers: {
      origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  })
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get('access-control-allow-origin'), origin)
})

test('重复保存复用同一操作，跨会话并发拒绝，保存后取消不谎称撤销', async (t) => {
  let release: (() => void) | undefined
  let saves = 0
  const profiles: Awaited<ReturnType<CredentialRepository['catalog']>>['profiles'] = []
  const repository: CredentialRepository = {
    async check() {
      return true
    },
    async delete() {
      throw new Error('本夹具不支持删除')
    },
    async catalog() {
      return { code: 'available', profiles }
    },
    async save(reference, channel) {
      saves++
      await new Promise<void>((resolve) => {
        release = resolve
      })
      profiles.push({ reference, channel, configured: true, revision: 'a'.repeat(64) })
    },
  }
  const { intake } = await fixture(t, repository)
  const a = await intake.session('huawei', origin)
  const b = await intake.session('huawei', origin)
  const first = await intake.engine.save(a.id, huawei)
  assert.ok(isCredentialOperation(first))
  assert.equal(
    (await intake.engine.save(a.id, { arbitrary: 'ignored on repeated operation' })).id,
    first.id,
  )
  await assert.rejects(intake.engine.save(b.id, { ...huawei, displayName: '另一个账号' }), {
    statusCode: 409,
  })
  assert.throws(() => intake.engine.cancel(a.id), { statusCode: 409 })
  release?.()
  assert.equal((await finished(intake, a.operationId)).status, 'saved')
  assert.equal(saves, 1)
  await assert.rejects(intake.engine.save(b.id, huawei), { statusCode: 409 })
})

test('过期和未提交取消拒绝写入；SDK 故障保留待核对，重启不重放材料', async (t) => {
  let now = Date.now()
  let writes = 0
  const repository: CredentialRepository = {
    async check() {
      return true
    },
    async delete() {
      throw new Error('本夹具不支持删除')
    },
    async catalog() {
      return { code: 'available', profiles: [] }
    },
    async save() {
      writes++
      throw new Error(syntheticSecret)
    },
  }
  const { root, intake } = await fixture(t, repository, () => now)
  const expired = await intake.session('huawei', origin)
  now += 5 * 60_000
  assert.throws(() => intake.engine.authorize(expired.id, expired.token, origin), {
    statusCode: 410,
  })
  await assert.rejects(intake.engine.save(expired.id, huawei), { statusCode: 410 })
  const cancelled = await intake.session('huawei', origin)
  intake.engine.cancel(cancelled.id)
  assert.throws(() => intake.engine.authorize(cancelled.id, cancelled.token, origin), {
    statusCode: 403,
  })
  const failing = await intake.session('huawei', origin)
  await intake.engine.save(failing.id, huawei)
  const result = await finished(intake, failing.operationId)
  assert.equal(result.status, 'needs_reconciliation')
  assert.ok(!JSON.stringify(result).includes(syntheticSecret))
  assert.equal((await intake.accounts()).accounts[0]?.needsReconciliation, true)
  const recovered = new CredentialIntakeEngine(
    new CredentialAccountStore(join(root, 'credential-accounts.json')),
    repository,
  )
  await recovered.initialize()
  assert.equal(writes, 1)
  const file = join(root, 'credential-accounts.json')
  await writeFile(file, '{broken')
  await assert.rejects(recovered.accounts())
  assert.equal(await readFile(file, 'utf8'), '{broken')
})

test('控制面只创建能力和查询安全结果，严格拒绝无来源和混入材料；关联数量来自绑定', async (t) => {
  const { root, intake } = await fixture(t)
  const projects = new FileProjectStore(join(root, 'projects.json'))
  const applications = new FileApplicationStore(join(root, 'applications.json'))
  // HTTP 已在 fixture 启动；控制端口生命周期使用显式无操作适配，避免启动两次。
  const control = {
    start: async () => {},
    close: async () => {},
    accounts: () => intake.accounts(),
    manage: (input: Parameters<typeof intake.manage>[0]) => intake.manage(input),
    session: (channel: 'huawei' | 'app_store', source: string) => intake.session(channel, source),
    operation: (id: string) => intake.operation(id),
  }
  const service = new CredentialAccountsService(control, [origin], projects, applications)
  const app = await createApp(projects, {
    applicationStore: applications,
    credentialAccounts: service,
  })
  t.after(() => app.close())
  const headers = { origin, 'x-release-harbor-setup': '1' }
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/local-credential-sessions',
        payload: { channel: 'huawei' },
      })
    ).statusCode,
    403,
  )
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/local-credential-sessions',
        headers,
        payload: { channel: 'huawei', clientSecret: syntheticSecret },
      })
    ).statusCode,
    400,
  )
  const response = await app.inject({
    method: 'POST',
    url: '/api/local-credential-sessions',
    headers,
    payload: { channel: 'huawei' },
  })
  assert.equal(response.statusCode, 201)
  assert.equal(response.headers['cache-control'], 'no-store')
  const session = response.json().session
  assert.ok(isCredentialSetupSession(session))
  await intake.engine.save(session.id, huawei)
  await finished(intake, session.operationId)
  const project = await new ProjectCatalog(projects).create('local', {
    name: '合成项目',
    key: 'account-test',
    framework: 'native',
  })
  const catalog = new ApplicationCatalog(projects, applications)
  const application = await catalog.create('local', project.id, {
    name: '合成应用',
    platform: 'android',
    identifier: 'com.example.test',
  })
  await catalog.bind('local', project.id, application.id, {
    channel: 'huawei',
    appId: '123456',
    credentialReference: session.reference,
  })
  const result = (await app.inject({ url: '/api/credential-accounts' })).json().catalog
  assert.ok(isCredentialAccounts(result))
  assert.equal(result.accounts[0]?.applicationCount, 1)
  assert.ok(!JSON.stringify(result).includes(syntheticSecret))
  assert.equal(
    (await app.inject({ url: `/api/credential-operations/${randomUUID()}` })).statusCode,
    404,
  )
})

test('真实子进程只读取隔离空目录并通过私有 IPC 创建会话，关闭不会遗留服务', async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'harbor-intake-worker-')))
  const intake = new LocalCredentialIntake(root, [origin])
  t.after(async () => {
    await intake.close()
    await rm(root, { recursive: true, force: true })
  })
  await intake.start()
  const catalog = await intake.accounts()
  assert.ok(isCredentialAccounts(catalog))
  assert.equal(catalog.accounts.length, 0)
  if (process.platform === 'darwin') {
    const session = await intake.session('app_store', origin)
    assert.ok(isCredentialSetupSession(session))
    assert.equal(await intake.operation(session.operationId), null)
    await assert.rejects(
      intake.manage({
        reference: 'missing-synthetic-account',
        expectedRevision: '0'.repeat(64),
        action: 'recheck',
      }),
      { statusCode: 404 },
    )
  }
  await intake.close()
  await assert.rejects(intake.accounts())
  // 维护快照会关闭再启动同一宿主；旧会话不延续，安全目录仍可重新读取。
  await intake.start()
  assert.equal((await intake.accounts()).accounts.length, 0)
  await intake.close()
})

test('材料判别联合拒绝跨渠道、路径、无效 Apple 标识及非 P-256 私钥', () => {
  assert.throws(() => validateCredentialSubmission('app_store', huawei))
  assert.throws(() =>
    validateCredentialSubmission('huawei', {
      ...huawei,
      credentials: { clientId: 'x', clientSecret: 'x', externalPath: '/tmp/key' },
    }),
  )
  assert.throws(() =>
    validateCredentialSubmission('app_store', {
      displayName: 'Apple',
      credentials: { apiIssuerId: 'invalid', apiKeyId: 'ABCDEFGHIJ', privateKey: 'invalid' },
    }),
  )
  assert.throws(() =>
    validateCredentialSubmission('app_store', {
      displayName: 'Apple',
      credentials: {
        apiIssuerId: '11111111-1111-4111-8111-111111111111',
        apiKeyId: 'ABCDEFGHIJ',
        privateKey: 'invalid',
      },
    }),
  )
})

test('配置进程启动遇到损坏标签文件时拒绝覆盖，并回收失败的子进程', async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'harbor-intake-corrupt-')))
  const file = join(root, 'credential-accounts.json')
  await writeFile(file, '{broken')
  const intake = new LocalCredentialIntake(root, [origin])
  t.after(async () => {
    await intake.close()
    await rm(root, { recursive: true, force: true })
  })
  await assert.rejects(intake.start(), /本机配置进程启动失败/)
  await assert.rejects(intake.accounts())
  assert.equal(await readFile(file, 'utf8'), '{broken')
})

test('保存受理中的取消和重复请求明确冲突，不会在承诺取消后继续写入', async (t) => {
  let blocked = false
  let release: (() => void) | undefined
  let writes = 0
  const profiles: Awaited<ReturnType<CredentialRepository['catalog']>>['profiles'] = []
  const repository: CredentialRepository = {
    async check() {
      return true
    },
    async delete() {
      throw new Error('本夹具不支持删除')
    },
    async catalog() {
      if (blocked)
        await new Promise<void>((resolve) => {
          release = resolve
        })
      return { code: 'available', profiles }
    },
    async save(reference, channel) {
      writes++
      profiles.push({ reference, channel, configured: true, revision: 'a'.repeat(64) })
    },
  }
  const { intake } = await fixture(t, repository)
  const session = await intake.session('huawei', origin)
  blocked = true
  const saving = intake.engine.save(session.id, huawei)
  void saving.catch(() => undefined)
  try {
    assert.throws(() => intake.engine.cancel(session.id), { statusCode: 409 })
    await assert.rejects(intake.engine.save(session.id, huawei), { statusCode: 409 })
  } finally {
    blocked = false
    release?.()
  }
  await saving
  assert.equal((await finished(intake, session.operationId)).status, 'saved')
  assert.equal(writes, 1)
})
