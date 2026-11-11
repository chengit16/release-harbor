/** @description 应用级成员授权的隔离回归；合成临时数据覆盖后加渠道、未绑应用、撤权和旧权限兼容。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { setup, terminal } from './fixtures/release-plans.ts'
import { isLocalTeamPermissions } from '../packages/contracts/src/index.ts'
import { LocalTeamPolicy } from '../apps/api/src/local-team/policy.ts'
import { LocalTeamStore } from '../apps/api/src/local-team/store.ts'

const secret = ['synthetic', 'application', 'passphrase'].join('-')
const host = '127.0.0.1:4399',
  origin = 'http://' + host

test('应用授权覆盖全部当前及后续渠道，跨应用仍拒绝且重启保留授权', async (t) => {
  let writes = 0
  const f = await setup(
    t,
    'android',
    {
      async run(_p, _id, permit) {
        await permit()
        writes++
        return 'draft_saved'
      },
      close() {},
    },
    { team: true },
  )
  assert.ok(f.team)
  await f.team.initialize('admin', secret)
  const member = await f.team.add('appuser', secret)
  const other = await f.catalog.create('local', f.application.projectId, {
    name: '未分配应用',
    platform: 'android',
    identifier: 'com.example.other',
  })
  const policy = new LocalTeamPolicy({ projects: f.projects, applications: f.catalog })
  const candidates = await policy.catalog()
  assert.equal(candidates.length, 2, '未配置渠道的应用也可授权')
  await assert.rejects(
    policy.validatePermissions({
      revision: 0,
      menus: [],
      grants: [],
      applications: [
        {
          projectId: 'wrong-project',
          applicationId: f.application.id,
          operations: ['review_read'],
        },
      ],
    }),
    '应用授权必须验证项目与应用归属',
  )
  await assert.rejects(
    new LocalTeamPolicy({}).validatePermissions({
      revision: 0,
      menus: [],
      grants: [],
      applications: [
        {
          projectId: f.application.projectId,
          applicationId: f.application.id,
          operations: ['review_read'],
        },
      ],
    }),
    '目录缺失不能跳过归属验证',
  )
  await f.team.setPermissions(member.id, {
    revision: 0,
    menus: ['projects', 'releases', 'reviews'],
    grants: [],
    applications: [
      {
        projectId: f.application.projectId,
        applicationId: f.application.id,
        operations: ['review_read', 'review_query', 'release_prepare', 'release_confirm'],
      },
    ],
  })
  const server = f.api.getHttpAdapter().getInstance()
  const login = await server.inject({
    method: 'POST',
    url: '/api/team/login',
    headers: { host, origin, 'x-release-harbor-team': '1' },
    payload: { username: member.username, password: secret },
  })
  assert.equal(login.statusCode, 200, login.body)
  const cookie = String(login.headers['set-cookie']).split(';')[0] ?? ''
  const headers = { host, origin, cookie, 'x-release-harbor-plan': '1' }
  const base = f.base.replace(/\/release-plans$/, '')
  const get = (url: string) => server.inject({ method: 'GET', url, headers: { host, cookie } })
  const list = await get(base + '/bindings')
  assert.equal(list.json().items.length, 1)
  await f.catalog.bind(...f.args, {
    channel: 'tencent',
    appId: '654321',
    credentialReference: 'synthetic-second',
  })
  assert.equal((await get(base + '/bindings')).json().items.length, 2)
  assert.equal(
    (await policy.catalog()).filter((v) => v.applicationId === f.application.id).length,
    1,
  )
  assert.equal((await get(base.replace(f.application.id, other.id))).statusCode, 403)
  const plan = await server.inject({ method: 'POST', url: f.base, headers, payload: f.input })
  assert.equal(plan.statusCode, 201, plan.body)
  const saved = (await f.store.list(...f.args))[0]
  assert.ok(saved)
  const execute = await server.inject({
    method: 'POST',
    url: `${f.base}/${saved.id}/confirm-and-execute`,
    headers,
    payload: { expectedDigest: saved.digest, acknowledged: true },
  })
  assert.equal(execute.statusCode, 201, execute.body)
  assert.equal((await terminal(f)).status, 'succeeded')
  assert.equal(writes, 1)
  assert.equal(
    (await new LocalTeamStore(f.root).read())?.find((a) => a.id === member.id)?.permissions
      ?.applications?.length,
    1,
  )
  await f.team.setPermissions(member.id, {
    revision: 1,
    menus: ['projects'],
    grants: [],
    applications: [],
  })
  assert.equal((await get(base)).statusCode, 403)
})

test('应用权限合同拒绝重复应用、未知操作和额外字段；旧渠道合同继续可读', () => {
  const grant = { projectId: 'project', applicationId: 'app', operations: ['release_prepare'] }
  const base = { revision: 0, menus: ['releases'], grants: [] }
  assert.ok(isLocalTeamPermissions(base))
  assert.ok(isLocalTeamPermissions({ ...base, applications: [grant] }))
  assert.equal(isLocalTeamPermissions({ ...base, applications: [grant, grant] }), false)
  assert.equal(
    isLocalTeamPermissions({ ...base, applications: [{ ...grant, operations: ['admin'] }] }),
    false,
  )
  assert.equal(
    isLocalTeamPermissions({ ...base, applications: [{ ...grant, workspaceId: 'other' }] }),
    false,
  )
})
