/** @description 本机团队范围、缓存与临执行撤权集成；隔离数据和合成 worker，不读取真实账号或请求商店。 */
import { AppleReviewService } from '../apps/api/src/apple-review.service.ts'
import { appleReviewTestClient } from './fixtures/apple-review.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setup, terminal } from './fixtures/release-plans.ts'
import {
  teamBindingFingerprint,
  teamContext,
  assertTeamBinding,
} from '../apps/api/src/local-team/access.ts'
import { StoreStatusService } from '../apps/api/src/store-status.service.ts'
import { StoreStatusStore } from '../apps/api/src/store-status-store.ts'
import { createApp } from '../apps/api/src/app.ts'
import { join } from 'node:path'
import {
  inspectAppleReview,
  readAppleReviewCatalog,
} from '../packages/provider-app-ship/src/apple-review-source.ts'
import { tencentDetails } from './fixtures/tencent-harmony.ts'
import type {
  LocalTeamPermissions,
  ChannelBinding,
  TeamBindingGrant,
} from '../packages/contracts/src/index.ts'

const secret = ['synthetic', 'team', 'passphrase'].join('-')
const host = '127.0.0.1:4399',
  origin = 'http://' + host
function grant(
  binding: ChannelBinding,
  operations: TeamBindingGrant['operations'] = ['review_read'],
): TeamBindingGrant {
  return {
    projectId: binding.projectId,
    applicationId: binding.applicationId,
    bindingId: binding.id,
    fingerprint: teamBindingFingerprint(binding),
    operations,
    releaseActions: ['huawei_save_draft'],
  }
}
async function login(
  server: {
    inject: (input: {
      method: string
      url: string
      headers: Record<string, string>
      payload: object
    }) => Promise<{ statusCode: number; headers: Record<string, unknown>; body: string }>
  },
  username: string,
): Promise<string> {
  const r = await server.inject({
    method: 'POST',
    url: '/api/team/login',
    headers: { host, origin, 'x-release-harbor-team': '1' },
    payload: { username, password: secret },
  })
  assert.equal(r.statusCode, 200, r.body)
  return String(r.headers['set-cookie']).split(';')[0] ?? ''
}

test('成员仅获分配的缓存、应用及绑定；直接接口、查询、上传与管理员维护分别受限', async (t) => {
  const f = await setup(t, 'android', undefined, { team: true })
  assert.ok(f.team)
  await f.team.initialize('admin', secret)
  const member = await f.team.add('reader', secret)
  const second = await f.catalog.bind(...f.args, {
    channel: 'tencent',
    appId: '654321',
    credentialReference: 'synthetic-other-account',
  })
  const other = await f.catalog.create('local', f.application.projectId, {
    name: '未授权应用',
    platform: 'android',
    identifier: 'com.example.other',
  })
  let calls = 0
  const status = new StoreStatusService(
    f.projects,
    f.catalog,
    new StoreStatusStore(join(f.root, 'team-status.json')),
    {
      async run(job) {
        calls++
        return {
          bindingId: job.binding.id,
          channel: job.binding.channel,
          checkedAt: new Date().toISOString(),
          code: 'observed',
          versions: [],
        }
      },
      close() {},
    },
    [origin],
  )
  const api = await createApp(f.projects, {
    team: f.team,
    applicationStore: f.applicationsStore,
    storeStatus: status,
    artifacts: f.artifacts,
    preflights: f.preflights,
    releasePlans: f.plans,
    execution: f.execution,
    preparations: f.preparations,
    batches: f.batches,
  })
  t.after(() => api.close())
  const server = api.getHttpAdapter().getInstance()
  const admin = await login(server, 'admin'),
    cookie = await login(server, 'reader')
  const get = (url: string) => server.inject({ method: 'GET', url, headers: { host, cookie } })
  const post = (url: string, payload: object, who = cookie) =>
    server.inject({
      method: 'POST',
      url,
      headers: {
        host,
        origin,
        cookie: who,
        'x-release-harbor-team': '1',
        'x-release-harbor-plan': '1',
        'x-release-harbor-query': '1',
      },
      payload,
    })
  let permissions: LocalTeamPermissions = {
    revision: 0,
    menus: ['reviews'],
    grants: [grant(f.binding)],
  }
  const save = async () => {
    const r = await post('/api/team/members/' + member.id + '/permissions', permissions, admin)
    assert.equal(r.statusCode, 200, r.body)
    permissions = r.json().permissions
  }
  await save()
  assert.equal(
    (
      await post(
        '/api/team/members/' + member.id + '/permissions',
        { ...permissions, revision: 0 },
        admin,
      )
    ).statusCode,
    409,
  )
  const response = await get('/api/store-status')
  assert.equal(response.statusCode, 200, response.body)
  assert.deepEqual(
    response.json().targets.map((v: { bindingId: string }) => v.bindingId),
    [f.binding.id],
  )
  assert.equal(calls, 0)
  const base = f.base.replace(/\/release-plans$/, '')
  assert.deepEqual(
    (await get(base + '/bindings')).json().items.map((v: { id: string }) => v.id),
    [f.binding.id],
  )
  assert.equal((await get(base.replace(f.application.id, other.id))).statusCode, 403)
  for (const path of [
    '/api/local',
    '/api/credential-accounts',
    '/api/profiles',
    '/api/release-center',
    '/api/team/members',
    '/api/team/grant-options',
  ])
    assert.equal((await get(path)).statusCode, 403, path)
  assert.equal((await post(base + '/artifacts', {})).statusCode, 403)
  const query = `/api/store-status/${f.application.projectId}/${f.application.id}/`
  assert.equal((await post(query + f.binding.id + '/query', {})).statusCode, 403)
  permissions.grants[0]?.operations.push('review_query')
  await save()
  assert.equal((await post(query + f.binding.id + '/query', {})).statusCode, 201)
  assert.equal(calls, 1)
  assert.equal((await post(query + second.id + '/query', {})).statusCode, 403)
  await get('/api/store-status')
  assert.equal(calls, 1)
  // 配置变化后原指纹不再可用，不能隐式获得新账号和目标的资格。
  await f.plans.freeze(...f.args, f.input)
  await f.catalog.updateBinding(...f.args, f.binding.id, {
    expectedRevision: 1,
    appId: '123457',
    credentialReference: f.binding.credentialReference,
  })
  assert.deepEqual((await get('/api/store-status')).json().targets, [])
  assert.equal((await post(query + f.binding.id + '/query', {})).statusCode, 403)
  const current = (await f.catalog.bindings(...f.args)).find((b) => b.id === f.binding.id)
  assert.ok(current)
  permissions.menus = ['reviews', 'releases']
  permissions.grants = [grant(current, ['review_read', 'release_prepare'])]
  await save()
  assert.deepEqual((await get(base + '/preflights')).json().items, [])
  assert.deepEqual((await get(f.base)).json().items, [])
  assert.equal((await post(f.base, f.input)).statusCode, 403, '旧幂等编号也不能返回旧绑定快照')
  permissions.menus = []
  permissions.grants = []
  await save()
  assert.equal((await get('/api/store-status')).statusCode, 403)
})

test('成员准备与确认全链路可用，刷新及重复确认不重复检查或执行', async (t) => {
  let permitted = 0
  const f = await setup(
    t,
    'android',
    {
      async run(_plan, _id, permit) {
        await permit()
        permitted++
        return 'draft_saved'
      },
      close() {},
    },
    { team: true },
  )
  assert.ok(f.team)
  await f.team.initialize('admin', secret)
  const member = await f.team.add('publisher', secret)
  await f.team.setPermissions(member.id, {
    revision: 0,
    menus: ['releases'],
    grants: [grant(f.binding, ['release_prepare', 'release_confirm'])],
  })
  const server = f.api.getHttpAdapter().getInstance()
  const cookie = await login(server, 'publisher')
  const headers = { host, origin, cookie, 'x-release-harbor-plan': '1' }
  const url = f.base.replace(/release-plans$/, 'release-preparations')
  const prepared = await server.inject({
    method: 'POST',
    url,
    headers,
    payload: {
      requestId: randomUUID(),
      bindingId: f.binding.id,
      artifactId: f.artifact.id,
      expectedBindingRevision: f.binding.revision,
      expectedArtifactSha256: f.artifact.sha256,
      releaseNotes: '合成成员发布说明',
    },
  })
  assert.equal(prepared.statusCode, 202, prepared.body)
  let records = await f.preparations.list(...f.args)
  for (let i = 0; i < 150 && records[0]?.status === 'checking'; i++) {
    await new Promise((r) => setTimeout(r, 10))
    records = await f.preparations.list(...f.args)
  }
  assert.equal(records[0]?.status, 'ready', JSON.stringify(records))
  const listed = await server.inject({ method: 'GET', url: f.base, headers: { host, cookie } })
  assert.equal(listed.statusCode, 200, listed.body)
  assert.equal(listed.json().items.length, 1)
  const plan = (await f.store.list(...f.args))[0]
  assert.ok(plan)
  assert.equal(plan.authorization, null)
  const checks = f.calls()
  await server.inject({ method: 'GET', url, headers: { host, cookie } })
  assert.equal(f.calls(), checks)
  for (let i = 0; i < 2; i++) {
    const executed: { statusCode: number; body: string } = await server.inject({
      method: 'POST',
      url: `${f.base}/${plan.id}/confirm-and-execute`,
      headers,
      payload: { expectedDigest: plan.digest, acknowledged: true },
    })
    assert.equal(executed.statusCode, 201, executed.body)
  }
  assert.equal((await terminal(f)).status, 'succeeded')
  assert.equal(permitted, 1)
})

test('准备与确认分别授权，发布已排队后撤权不得获得商店写许可', async (t) => {
  let releaseWorker: () => void = () => undefined,
    entered: () => void = () => undefined,
    permitted = 0
  const waiting = new Promise<void>((r) => {
      releaseWorker = r
    }),
    started = new Promise<void>((r) => {
      entered = r
    })
  const f = await setup(
    t,
    'android',
    {
      async run(_p, _id, permit) {
        entered()
        await waiting
        await permit()
        permitted++
        return 'draft_saved'
      },
      close() {
        releaseWorker()
      },
    },
    {
      team: true,
      check: async (task) => ({
        code: 'verified',
        artifact: 'passed',
        authentication: 'passed',
        target: 'passed',
        ...(task?.channel === 'tencent' ? { tencent: tencentDetails } : {}),
      }),
    },
  )
  assert.ok(f.team)
  await f.team.initialize('admin', secret)
  const member = await f.team.add('publisher', secret)
  let permissions: LocalTeamPermissions = {
    revision: 0,
    menus: ['releases'],
    grants: [grant(f.binding, ['release_prepare'])],
  }
  await f.team.setPermissions(member.id, permissions)
  const server = f.api.getHttpAdapter().getInstance(),
    cookie = await login(server, 'publisher')
  const post = (url: string, payload: object) =>
    server.inject({
      method: 'POST',
      url,
      headers: { host, origin, cookie, 'x-release-harbor-plan': '1' },
      payload,
    })
  const plan = await f.plans.freeze(...f.args, f.input)
  const body = { expectedDigest: plan.digest, acknowledged: true }
  assert.equal((await post(f.base + '/' + plan.id + '/confirm-and-execute', body)).statusCode, 403)
  const account = (await f.team.read())?.find((a) => a.id === member.id)
  assert.ok(account)
  await teamContext.run({ store: f.team, id: account.id, revision: account.revision }, () =>
    assertTeamBinding(f.binding, 'release_prepare', 'huawei_save_draft'),
  )
  permissions = { ...permissions, revision: 1, grants: [grant(f.binding, ['release_confirm'])] }
  await f.team.setPermissions(member.id, permissions)
  assert.equal((await post(f.base, { ...f.input, requestId: randomUUID() })).statusCode, 403)
  const result = await post(f.base + '/' + plan.id + '/confirm-and-execute', body)
  assert.equal(result.statusCode, 201, result.body)
  await started
  await f.team.setPermissions(member.id, { revision: 2, menus: ['releases'], grants: [] })
  releaseWorker()
  const finished = await terminal(f)
  assert.equal(permitted, 0)
  assert.equal(finished.remoteStartedAt, null)
  assert.equal(finished.status, 'interrupted')
})

test('批次整组确认拒绝越界，临写撤权后全部剩余目标无许可', async (t) => {
  let releaseWorker: () => void = () => undefined,
    entered: () => void = () => undefined,
    permitted = 0
  const waiting = new Promise<void>((r) => {
      releaseWorker = r
    }),
    started = new Promise<void>((r) => {
      entered = r
    })
  const f = await setup(
    t,
    'android',
    {
      async run(plan, id, permit, _report, batch) {
        assert.ok(batch)
        entered()
        await waiting
        await permit({
          batchId: batch.batchId,
          revisionId: batch.revisionId,
          targetId: batch.targetId,
          attemptId: id,
          planDigest: plan.digest,
          checkedAt: batch.consent.issuedAt,
          artifactSha256: plan.snapshot.artifact.sha256 ?? '',
          profileRevision: plan.snapshot.preflight.profileRevision,
          scope: 'artifact_profile_merchant_source',
        })
        permitted++
        return 'draft_saved'
      },
      close() {
        releaseWorker()
      },
    },
    {
      team: true,
      check: async (task) => ({
        code: 'verified',
        artifact: 'passed',
        authentication: 'passed',
        target: 'passed',
        ...(task?.channel === 'tencent' ? { tencent: tencentDetails } : {}),
      }),
    },
  )
  assert.ok(f.team)
  await f.team.initialize('admin', secret)
  const member = await f.team.add('batcher', secret)
  const second = await f.catalog.bind(...f.args, {
    channel: 'tencent',
    appId: '654321',
    credentialReference: 'synthetic-second',
  })
  f.profiles.profiles.push({
    reference: second.credentialReference,
    channel: 'tencent',
    configured: true,
    revision: 'a'.repeat(64),
  })
  const targets = [f.binding, second].map((b) => ({
    bindingId: b.id,
    artifactId: f.artifact.id,
    expectedBindingRevision: 1,
    expectedArtifactSha256: f.artifact.sha256,
    releaseNotes: '修复登录并优化体验',
    releasePolicy: { mode: 'after_approval' },
  }))
  const b = await f.batches.create(...f.args, { requestId: randomUUID(), targets })
  await f.batches.prepare(...f.args, b.id, {
    requestId: randomUUID(),
    expectedRevision: b.editVersion,
  })
  let prepared = await f.batches.get(...f.args, b.id)
  for (let i = 0; i < 150 && !prepared.revisions[0]?.preparedAt; i++) {
    await new Promise((r) => setTimeout(r, 10))
    prepared = await f.batches.get(...f.args, b.id)
  }
  const revision = prepared.revisions[0]
  assert.ok(revision?.digest, JSON.stringify(prepared))
  const allGrants = [
    grant(f.binding, ['release_confirm']),
    { ...grant(second, ['release_confirm']), releaseActions: ['tencent_submit_review' as const] },
  ]
  await f.team.setPermissions(member.id, {
    revision: 0,
    menus: ['releases'],
    grants: [allGrants[0]].filter((v): v is TeamBindingGrant => !!v),
  })
  const server = f.api.getHttpAdapter().getInstance(),
    cookie = await login(server, 'batcher')
  const root = f.base.replace(/release-plans$/, 'release-batches')
  const post = () =>
    server.inject({
      method: 'POST',
      url: `${root}/${b.id}/revisions/${revision.id}/confirm-and-start`,
      headers: { host, origin, cookie, 'x-release-harbor-plan': '1' },
      payload: { requestId: randomUUID(), expectedDigest: revision.digest, acknowledged: true },
    })
  assert.equal((await post()).statusCode, 403)
  const hidden = await server.inject({ method: 'GET', url: root, headers: { host, cookie } })
  assert.deepEqual(hidden.json().items, [])
  assert.equal((await f.batches.get(...f.args, b.id)).revisions[0]?.run, null)
  await f.team.setPermissions(member.id, { revision: 1, menus: ['releases'], grants: allGrants })
  const confirmed = await post()
  assert.equal(confirmed.statusCode, 202, confirmed.body)
  await started
  await f.team.setPermissions(member.id, { revision: 2, menus: ['releases'], grants: [] })
  releaseWorker()
  for (let i = 0; i < 150; i++) {
    prepared = await f.batches.get(...f.args, b.id)
    if (prepared.revisions[0]?.run?.finishedAt) break
    await new Promise((r) => setTimeout(r, 10))
  }
  assert.ok(prepared.revisions[0]?.run?.finishedAt)
  assert.equal(permitted, 0)
  assert.ok((await f.execution.list(...f.args)).every((a) => a.remoteStartedAt === null))
})

test('Apple 已有构建送审与手动发布独立授权，撤权阻止临执行许可', async (t) => {
  const f = await setup(t, 'ios', undefined, { team: true })
  assert.ok(f.team)
  const n = await appleReviewTestClient(
    join(f.root, 'synthetic-apple', 'profiles.json'),
    f.binding,
    f.application.identifier,
  )
  let releaseWorker: () => void = () => undefined,
    entered: () => void = () => undefined,
    permitted = 0
  const waiting = new Promise<void>((r) => {
      releaseWorker = r
    }),
    started = new Promise<void>((r) => {
      entered = r
    })
  const service = new AppleReviewService(f.catalog, f.preflights, f.store, {
    async run(job, permit) {
      if (job.kind === 'execute') {
        entered()
        await waiting
        await permit?.()
        permitted++
        return { ok: true, value: 'submitted' }
      }
      if (job.kind === 'catalog')
        return {
          ok: true,
          value: await readAppleReviewCatalog(n.client, job.binding, job.identifier),
        }
      if (job.kind === 'prepare')
        return {
          ok: true,
          value: (
            await inspectAppleReview(
              n.client,
              job.binding,
              job.identifier,
              job.buildId,
              job.versionId,
              job.action,
              job.mode,
              job.notes,
              'a'.repeat(64),
            )
          ).snapshot,
        }
      return { ok: false, code: 'interrupted' }
    },
    close() {
      releaseWorker()
    },
  })
  t.after(() => service.onModuleDestroy())
  await f.team.initialize('admin', secret)
  const member = await f.team.add('appler', secret)
  const g = {
    ...grant(f.binding, ['release_prepare', 'release_confirm']),
    releaseActions: ['apple_submit_review' as const],
  }
  await f.team.setPermissions(member.id, { revision: 0, menus: ['releases'], grants: [g] })
  const api = await createApp(f.projects, {
    team: f.team,
    applicationStore: f.applicationsStore,
    releasePlans: f.plans,
    appleReview: service,
  })
  t.after(() => api.close())
  const server = api.getHttpAdapter().getInstance(),
    cookie = await login(server, 'appler')
  const base = f.base.replace(/release-plans$/, 'apple-review')
  const post = (part: string, payload: object) =>
    server.inject({
      method: 'POST',
      url: base + part,
      headers: { host, origin, cookie, 'x-release-harbor-plan': '1' },
      payload,
    })
  const input = {
    requestId: randomUUID(),
    bindingId: f.binding.id,
    buildId: 'B1',
    versionId: 'V1',
    action: 'submit',
    mode: 'manual',
    notes: '修复问题',
  }
  const forbidden = await post('/prepare', {
    ...input,
    requestId: randomUUID(),
    action: 'release',
    notes: '',
  })
  assert.equal(forbidden.statusCode, 403)
  const prepared = await post('/prepare', input)
  assert.equal(prepared.statusCode, 201, prepared.body)
  const record = prepared.json().record
  const execute = await post('/' + record.id + '/execute', {
    expectedDigest: record.digest,
    acknowledged: true,
  })
  assert.equal(execute.statusCode, 201, execute.body)
  await started
  await f.team.setPermissions(member.id, { revision: 1, menus: ['releases'], grants: [] })
  releaseWorker()
  let saved = await service.list(f.application.projectId, f.application.id)
  for (let i = 0; i < 100 && !saved[0]?.finishedAt; i++) {
    await new Promise((r) => setTimeout(r, 10))
    saved = await service.list(f.application.projectId, f.application.id)
  }
  assert.equal(permitted, 0)
  assert.equal(saved[0]?.remoteStartedAt, null)
  assert.equal(saved[0]?.status, 'failed')
})
