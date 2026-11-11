/** @description 团队审计集成验收；隔离账号、业务文件和合成执行器，验证幂等、故障、撤权与恢复，不连接商店。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setup, terminal } from './fixtures/release-plans.ts'
import { TeamAuditQuery } from '../apps/api/src/local-team/audit-query.ts'
import { LocalTeamStore } from '../apps/api/src/local-team/store.ts'
import { teamContext } from '../apps/api/src/local-team/access.ts'
import { FileReleasePlanStore } from '../apps/api/src/release-plan-store.ts'
import { LocalBackupService, localDataRoot } from '../apps/api/src/local-backup.ts'
import { RecoverySafety } from '../apps/api/src/recovery-safety.ts'
import { attemptBlocksTarget } from '../apps/api/src/release-reconciliation.ts'
import {
  isTeamAuditPage,
  type LocalTeamMember,
  type TeamOperation,
} from '../packages/contracts/src/index.ts'

const secret = ['synthetic', 'audit', 'passphrase'].join('-')
const host = '127.0.0.1:4399',
  origin = 'http://' + host
async function fixture(t: test.TestContext) {
  let runs = 0
  const f = await setup(
    t,
    'android',
    {
      async run(_p, _id, permit) {
        runs++
        await permit()
        return 'needs_reconciliation'
      },
      close() {},
    },
    { team: true },
  )
  assert.ok(f.team)
  const team = f.team
  await team.initialize('admin', secret)
  const admin = (await team.read())?.[0]
  assert.ok(admin)
  const server = f.api.getHttpAdapter().getInstance()
  const post = (url: string, payload: object, cookie: string) =>
    server.inject({
      method: 'POST',
      url,
      headers: { host, origin, cookie, 'x-release-harbor-team': '1', 'x-release-harbor-plan': '1' },
      payload,
    })
  const get = (url: string, cookie: string) =>
    server.inject({ method: 'GET', url, headers: { host, cookie } })
  async function login(username: string): Promise<string> {
    const r = await post('/api/team/login', { username, password: secret }, '')
    assert.equal(r.statusCode, 200, r.body)
    return String(r.headers['set-cookie']).split(';')[0] ?? ''
  }
  const cookie = await login('admin')
  async function member(username: string, operations: TeamOperation[]) {
    const r = await post('/api/team/members', { username, password: secret }, cookie)
    assert.equal(r.statusCode, 201, r.body)
    const m: LocalTeamMember = r.json()
    const saved = await post(
      '/api/team/members/' + m.id + '/permissions',
      {
        revision: 0,
        menus: ['releases'],
        grants: [],
        applications: [
          { projectId: f.application.projectId, applicationId: f.application.id, operations },
        ],
      },
      cookie,
    )
    assert.equal(saved.statusCode, 200, saved.body)
    return { member: m, cookie: await login(username) }
  }
  return { ...f, team, admin, post, get, login, member, cookie, runs: () => runs }
}

test('成员变更与安全日志原子保存；前后范围、分页筛选及口令排除', async (t) => {
  const f = await fixture(t)
  const m = await f.member('preparer', ['release_prepare'])
  await f.post('/api/team/members/' + m.member.id, { action: 'disable' }, f.cookie)
  await f.post('/api/team/members/' + m.member.id, { action: 'enable' }, f.cookie)
  const replacement = ['synthetic', 'replacement', 'audit'].join('-')
  await f.post(
    '/api/team/members/' + m.member.id,
    { action: 'reset', password: replacement },
    f.cookie,
  )
  const r = await f.get('/api/team/audit?memberId=' + m.member.id, f.cookie)
  assert.equal(r.statusCode, 200, r.body)
  assert.ok(isTeamAuditPage(r.json()))
  assert.deepEqual(
    r.json().items.map((e: { action: string }) => e.action),
    ['member_reset', 'member_enable', 'member_disable', 'member_permissions', 'member_create'],
  )
  assert.ok(
    r
      .json()
      .items.every(
        (e: { actor: { id: string }; state: string }) =>
          e.actor.id === f.admin.id && e.state === 'atomic',
      ),
  )
  const change = r.json().items.find((e: { action: string }) => e.action === 'member_permissions')
  assert.equal(change.member.before.permissions, undefined)
  assert.equal(change.member.after.permissions.applications[0].operations[0], 'release_prepare')
  for (const key of [secret, replacement, 'password', 'hash', 'salt', 'credentialReference'])
    assert.equal(r.body.includes(key), false, key)
  assert.equal((await f.get('/api/team/audit?action=member_permissions', f.cookie)).json().total, 1)
  assert.equal(
    (await f.get('/api/team/audit?applicationId=' + f.application.id, f.cookie)).json().total,
    4,
  )
  for (const query of [
    'workspaceId=other',
    'page=0',
    'action=unknown',
    'from=wrong',
    'from=2026-11-12T00%3A00%3A00.000Z&to=2026-11-11T00%3A00%3A00.000Z',
  ])
    assert.equal((await f.get('/api/team/audit?' + query, f.cookie)).statusCode, 400)
  const count = r.json().total
  assert.equal(
    (
      await f.post(
        '/api/team/members/' + m.member.id + '/permissions',
        {
          revision: 0,
          menus: [],
          grants: [],
        },
        f.cookie,
      )
    ).statusCode,
    409,
  )
  assert.equal((await f.get('/api/team/audit', f.cookie)).json().total, count)
  const stored = await new LocalTeamStore(f.root).audit()
  assert.equal(stored.length, count)
  // 日志损坏锁定团队，不能降级为空目录后覆盖。
  const path = join(f.root, '.local', 'team.json')
  const data = JSON.parse(await readFile(path, 'utf8'))
  data.audit[0].event.actor.token = 'forbidden'
  const bad = JSON.stringify(data)
  await writeFile(path, bad)
  await assert.rejects(new LocalTeamStore(f.root).read(), /审计无法读取/)
  await assert.rejects(f.team.add('rejected', secret), /审计无法读取/)
  assert.equal(await readFile(path, 'utf8'), bad)
})

test('分离准备与确认身份，尝试／许可／人工核对关联回执；幂等和撤权不改原操作者', async (t) => {
  const f = await fixture(t)
  const p = await f.member('preparer', ['release_prepare'])
  const c = await f.member('confirmer', ['release_confirm', 'release_reconcile'])
  const prepared = await f.post(f.base, f.input, p.cookie)
  assert.equal(prepared.statusCode, 201, prepared.body)
  const plan = prepared.json().plan
  const body = { expectedDigest: plan.digest, acknowledged: true }
  assert.equal(
    (await f.post(f.base + '/' + plan.id + '/confirm-and-execute', body, p.cookie)).statusCode,
    403,
  )
  const execute = await f.post(f.base + '/' + plan.id + '/confirm-and-execute', body, c.cookie)
  assert.equal(execute.statusCode, 201, execute.body)
  const attempt = await terminal(f)
  assert.equal(attempt.status, 'needs_reconciliation')
  assert.ok(attempt.remoteStartedAt)
  await f.post(f.base + '/' + plan.id + '/confirm-and-execute', body, c.cookie)
  const reconcile =
    f.base.replace(/release-plans$/, 'release-attempts') + '/' + attempt.id + '/reconcile'
  const input = { ...body, versionName: '1.2.3', buildNumber: '42', decision: 'draft_present' }
  assert.equal((await f.post(reconcile, input, c.cookie)).statusCode, 201)
  assert.equal((await f.post(reconcile, input, c.cookie)).statusCode, 201)
  const url = `/api/team/records/${f.application.projectId}/${f.application.id}/plan/${plan.id}`
  const r = await f.get(url, p.cookie)
  assert.equal(r.statusCode, 200, r.body)
  assert.ok(isTeamAuditPage(r.json()))
  const items = r.json().items
  assert.equal(items.length, 5)
  assert.equal(
    items.find((e: { action: string }) => e.action === 'release_prepare').actor.id,
    p.member.id,
  )
  assert.ok(
    items
      .filter((e: { action: string }) => e.action !== 'release_prepare')
      .every(
        (e: { actor: { id: string }; state: string }) =>
          e.actor.id === c.member.id && e.state === 'matched',
      ),
  )
  assert.equal(
    items.find((e: { action: string }) => e.action === 'release_reconcile').outcome.id,
    attempt.id,
  )
  assert.equal(
    items.find((e: { action: string }) => e.action === 'release_permit').outcome.status,
    'needs_reconciliation',
  )
  assert.equal(f.runs(), 1)
  assert.equal((await f.get('/api/team/audit', p.cookie)).statusCode, 403)
  assert.equal((await f.get(url.replace(f.application.id, randomUUID()), p.cookie)).statusCode, 404)
  const before = await f.get('/api/team/audit?memberId=' + p.member.id, f.cookie)
  assert.ok(before.json().items.some((e: { action: string }) => e.action === 'release_prepare'))
  const revoked = await f.post(
    '/api/team/members/' + p.member.id + '/permissions',
    { revision: 1, menus: ['releases'], grants: [] },
    f.cookie,
  )
  assert.equal(revoked.statusCode, 200, revoked.body)
  assert.equal((await f.get(url, p.cookie)).statusCode, 403)
  const fresh = new FileReleasePlanStore(f.file)
  assert.deepEqual(await fresh.attempts(...f.args), await f.store.attempts(...f.args))
  const disk = JSON.parse(await readFile(f.file, 'utf8'))
  assert.equal(disk.schemaVersion, 17)
  assert.equal(disk.auditLinks.length, 5)
})

test('业务写入失败保留未匹配意图，后来相同核对由新操作者完成时不认领旧意图', async (t) => {
  const f = await fixture(t)
  const p = await f.member('publisher', ['release_prepare', 'release_confirm', 'release_reconcile'])
  const prepared = await f.post(f.base, f.input, p.cookie)
  const plan = prepared.json().plan
  await f.post(
    f.base + '/' + plan.id + '/confirm-and-execute',
    { expectedDigest: plan.digest, acknowledged: true },
    p.cookie,
  )
  const attempt = await terminal(f)
  const url = f.base.replace(/release-plans$/, 'release-attempts') + '/' + attempt.id + '/reconcile'
  const body = {
    expectedDigest: plan.digest,
    acknowledged: true,
    versionName: '1.2.3',
    buildNumber: '42',
    decision: 'draft_present',
  }
  const original = f.team.recordFacts.bind(f.team)
  // 在审计成功与业务 rename 之间注入文件故障，覆盖跨文件崩溃窗口。
  f.team.recordFacts = async (actor, facts) => {
    const links = await original(actor, facts)
    if (facts.some((f) => f.action === 'release_reconcile')) {
      await rename(f.file, f.file + '.saved')
      await mkdir(f.file)
    }
    return links
  }
  assert.equal((await f.post(url, body, p.cookie)).statusCode, 500)
  f.team.recordFacts = original
  await rm(f.file, { recursive: true })
  await rename(f.file + '.saved', f.file)
  assert.equal((await f.execution.list(...f.args))[0]?.reconciliation, undefined)
  let logs = (await f.get('/api/team/audit?action=release_reconcile', f.cookie)).json()
  assert.equal(logs.items[0].state, 'unmatched')
  // 固定测试时钟使两次核对事实完全相同，唯一提交凭证仍能区分失败意图。
  assert.equal((await f.post(url, body, f.cookie)).statusCode, 201)
  logs = (await f.get('/api/team/audit?action=release_reconcile', f.cookie)).json()
  assert.equal(logs.items.length, 2)
  assert.equal(logs.items[0].state, 'matched')
  assert.equal(logs.items[0].actor.id, f.admin.id)
  assert.equal(logs.items[1].state, 'unmatched')
  const record = await f.get(
    `/api/team/records/${f.application.projectId}/${f.application.id}/plan/${plan.id}`,
    f.cookie,
  )
  assert.equal(
    record.json().items.filter((e: { action: string }) => e.action === 'release_reconcile').length,
    1,
  )
  assert.equal(f.runs(), 1)
})

test('备份和恢复保留安装账号、停用、审计及未知／版本保护，旧许可不复活', async (t) => {
  const f = await fixture(t)
  const p = await f.member('publisher', ['release_prepare', 'release_confirm'])
  const identity = await localDataRoot(f.root)
  const safety = new RecoverySafety(join(f.root, '.local', 'release-safety.json'))
  const backups = new LocalBackupService(f.root, f.root, identity.installation, safety)
  const prepared = await f.post(f.base, f.input, p.cookie)
  const plan = prepared.json().plan
  const backup = await backups.create()
  const raw = await backups.download(backup.id)
  assert.equal(raw.includes('team.json'), false)
  assert.equal(raw.includes(secret), false)
  await f.post(
    f.base + '/' + plan.id + '/confirm-and-execute',
    { expectedDigest: plan.digest, acknowledged: true },
    p.cookie,
  )
  const attempt = await terminal(f)
  await f.post('/api/team/members/' + p.member.id, { action: 'disable' }, f.cookie)
  const before = await readFile(join(f.root, '.local', 'team.json'), 'utf8')
  const preview = await backups.preview(raw)
  await backups.restore(preview.id, preview.digest)
  assert.equal(await readFile(join(f.root, '.local', 'team.json'), 'utf8'), before)
  const restarted = new LocalTeamStore(f.root)
  assert.equal((await restarted.read())?.find((a) => a.id === p.member.id)?.enabled, false)
  assert.ok((await restarted.audit()).some((e) => e.event.action === 'release_permit'))
  const protections = await safety.protections()
  assert.ok(protections.some((e) => e.id === attempt.id && e.unknown))
  const selected = await localDataRoot(f.root)
  const restored = new FileReleasePlanStore(join(selected.data, 'release-plans.json'), safety)
  const saved = (await restored.list(...f.args))[0]
  assert.ok(saved)
  const facts = await f.store.backupState()
  // 相同摘要的旧许可在恢复账本中退役，即使手工再次尝试更新也无法获得写入资格。
  await assert.rejects(
    restored.execution(async (plans, attempts) => {
      plans[0] = facts.plans[0] ?? saved
      attempts.push(attempt)
    }),
    /恢复|退役|过期/,
  )
  assert.equal(attemptBlocksTarget(attempt, facts.plans[0] ?? saved, saved), true)
  const present = {
    ...attempt,
    reconciliation: {
      decision: 'draft_present' as const,
      checkedAt: attempt.finishedAt ?? '',
      source: 'local_user' as const,
    },
  }
  assert.equal(attemptBlocksTarget(present, facts.plans[0] ?? saved, saved), true)
  assert.equal(f.runs(), 1)
})

test('许可后即使审计损坏也保留实际终态，审计故障拒绝新的发布准备', async (t) => {
  let entered: () => void = () => undefined,
    finish: () => void = () => undefined
  const started = new Promise<void>((r) => {
    entered = r
  })
  const wait = new Promise<void>((r) => {
    finish = r
  })
  const f = await setup(
    t,
    'android',
    {
      async run(_plan, _id, permit) {
        await permit()
        entered()
        await wait
        return 'draft_saved'
      },
      close() {
        finish()
      },
    },
    { team: true },
  )
  assert.ok(f.team)
  await f.team.initialize('admin', secret)
  const admin = (await f.team.read())?.[0]
  assert.ok(admin)
  const actor = { store: f.team, id: admin.id, revision: admin.revision }
  const plan = await teamContext.run(actor, () => f.plans.freeze(...f.args, f.input))
  await teamContext.run(actor, () =>
    f.execution.start(
      ...f.args,
      plan.id,
      { expectedDigest: plan.digest, acknowledged: true },
      true,
    ),
  )
  await started
  const path = join(f.root, '.local', 'team.json')
  const good = await readFile(path, 'utf8')
  await writeFile(path, '{')
  finish()
  const attempt = await terminal(f)
  assert.equal(attempt.status, 'succeeded')
  assert.ok(attempt.remoteStartedAt)
  await assert.rejects(
    teamContext.run(actor, () =>
      f.plans.freeze(...f.args, { ...f.input, requestId: randomUUID() }),
    ),
    /审计无法读取/,
  )
  assert.equal((await f.plans.history(...f.args)).length, 1)
  await writeFile(path, good)
  assert.equal((await f.team.audit()).filter((e) => e.event.action === 'release_permit').length, 1)
})

test('旧团队目录只读不迁移；筛选后分页保留全部事件并使用精确时间范围', async (t) => {
  const f = await setup(t, 'android', undefined, { team: true })
  assert.ok(f.team)
  const team = f.team
  await team.initialize('admin', secret)
  const path = join(f.root, '.local', 'team.json')
  const before = await readFile(path, 'utf8')
  assert.deepEqual(await team.audit(), [])
  assert.equal(await readFile(path, 'utf8'), before)
  const admin = (await team.read())?.[0]
  assert.ok(admin)
  const member = await team.add('reader', secret)
  for (let revision = 0; revision < 53; revision++) {
    await teamContext.run({ store: team, id: admin.id, revision: admin.revision }, () =>
      team.setPermissions(member.id, {
        revision,
        menus: revision % 2 ? ['reviews'] : [],
        grants: [],
      }),
    )
  }
  const query = new TeamAuditQuery(team)
  const first = await query.list({ memberId: member.id, action: 'member_permissions' })
  const second = await query.list({ memberId: member.id, action: 'member_permissions', page: '2' })
  assert.equal(first.total, 53)
  assert.equal(first.items.length, 50)
  assert.equal(second.items.length, 3)
  assert.equal(new Set([...first.items, ...second.items].map((e) => e.id)).size, 53)
  const at = second.items[2]?.at
  assert.ok(at)
  const exact = await query.list({ from: at, to: at })
  assert.ok(exact.total >= 1)
  assert.ok(exact.items.every((e) => e.at === at))
})
