/** @description 独立官方状态的渠道回归；只使用内存材料与合成网络，覆盖字典、旧在架分离和公开页边界。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { BindingChannel, StoreStatusJob } from '../packages/contracts/src/index.ts'
import {
  credentialStore,
  validateCredentialSubmission,
} from '../packages/provider-app-ship/src/index.ts'
import { queryStoreStatus } from '../packages/provider-app-ship/src/store-status.ts'
import { MemoryCredentialSecrets } from './fixtures/credential-intake.ts'
import { harmonyCredentials, tencentCredentials } from './fixtures/tencent-harmony.ts'
import { vivoCredentials } from './fixtures/vivo.ts'
import { oppoCredentials } from './fixtures/oppo.ts'

async function fixture(t: test.TestContext, channel: BindingChannel) {
  const root = await mkdtemp(join(tmpdir(), 'harbor-query-channels-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const job: StoreStatusJob = {
    identifier: 'com.example.query',
    binding: {
      id: randomUUID(),
      workspaceId: 'local',
      projectId: randomUUID(),
      applicationId: randomUUID(),
      channel,
      appId: ['xiaomi', 'vivo', 'oppo'].includes(channel) ? 'com.example.query' : '123456',
      credentialReference: 'synthetic-query',
      revision: 1,
      verification: 'not_checked',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  }
  const store = credentialStore(join(root, 'profiles.json'), new MemoryCredentialSecrets())
  if (channel !== 'xiaomi')
    await store.saveProfile({
      credentialProfile: job.binding.credentialReference,
      platform: channel,
      material: validateCredentialSubmission(channel, {
        displayName: '合成查询',
        credentials:
          channel === 'vivo'
            ? vivoCredentials
            : channel === 'oppo'
              ? oppoCredentials
              : channel === 'tencent'
                ? tencentCredentials
                : harmonyCredentials,
      }).material,
    })
  return { job, store }
}

for (const channel of ['huawei', 'harmony'] as const) {
  test(`${channel} 全网字典与固定路由；旧在架不覆盖当前审核，缺状态和错应用拒绝`, async (t) => {
    const f = await fixture(t, channel)
    let info: Record<string, unknown> = {
      releaseState: 5,
      versionNumber: '2.0',
      versionCode: 20,
      versionId: 'current',
      onShelfVersionNumber: '1.0',
      onShelfVersionCode: 10,
      onShelfVersionId: 'old',
    }
    let wrong = false
    const paths: string[] = []
    const transport: typeof fetch = async (raw, init) => {
      const url = new URL(String(raw))
      paths.push(url.pathname)
      assert.equal(url.origin, 'https://connect-api.cloud.huawei.com')
      assert.equal(init?.redirect, 'error')
      if (url.pathname.endsWith('/token')) return Response.json({ access_token: 'synthetic-token' })
      assert.equal(init?.method, 'GET')
      if (url.pathname.endsWith('/appid-list')) {
        assert.equal(url.searchParams.get('packageName'), f.job.identifier)
        assert.equal(url.searchParams.get('packageTypes'), channel === 'harmony' ? '7' : null)
        return Response.json({
          ret: { code: 0 },
          appids: [{ value: wrong ? 'wrong' : f.job.binding.appId }],
        })
      }
      assert.equal(url.pathname, `/api/publish/${channel === 'harmony' ? 'v3' : 'v2'}/app-info`)
      assert.equal(url.searchParams.get('releaseType'), '1')
      assert.equal(url.searchParams.get('appId'), f.job.binding.appId)
      return Response.json({
        ret: JSON.stringify({ code: 0 }),
        appInfo: { ...info, testUserPassword: 'must-not-escape' },
      })
    }
    const query = () => queryStoreStatus(f.job, f.store, transport)
    const initial = await query()
    assert.equal(initial.code, 'observed')
    assert.deepEqual(
      initial.versions.map((v) => [v.versionId, v.state]),
      [
        ['current', 'in_review'],
        ['old', 'published'],
      ],
    )
    assert.equal(JSON.stringify(initial).includes('must-not-escape'), false)
    for (const [value, state] of [
      [0, 'published'],
      [1, 'rejected'],
      [2, 'removed'],
      [3, 'pending_release'],
      [4, 'in_review'],
      [6, 'removal_pending'],
      [7, 'draft'],
      [8, 'rejected'],
      [9, 'removal_rejected'],
      [10, 'removed'],
      [11, 'withdrawn'],
      [12, 'pre_review'],
      [13, 'pre_rejected'],
      [99, 'unknown'],
    ] as const) {
      info = { releaseState: value }
      assert.equal((await query()).versions[0]?.state, state)
    }
    info = {
      releaseState: 5,
      versionNumber: '2.0',
      versionCode: 20,
      onShelfVersionNumber: '2.0',
      onShelfVersionCode: 20,
    }
    assert.equal((await query()).versions.length, 1)
    for (const invalid of [
      {},
      { releaseState: 4, releaseType: 6 },
      { releaseState: 4, packageName: 'com.wrong' },
    ]) {
      info = invalid
      assert.equal((await query()).code, 'invalid_response')
    }
    wrong = true
    assert.equal((await query()).code, 'invalid_response')
    assert.ok(paths.every((path) => /\/(token|appid-list|app-info)$/.test(path)))
  })
}

test('vivo 官方审核字典优先，旧包在架不能覆盖审核中、拒绝和撤审', async (t) => {
  const f = await fixture(t, 'vivo')
  let status: unknown = 2,
    saleStatus = 1
  const transport: typeof fetch = async (raw, init) => {
    assert.equal(String(raw), 'https://developer-api.vivo.com.cn/router/rest')
    assert.equal(new URLSearchParams(String(init?.body)).get('method'), 'app.query.details')
    return Response.json({
      code: 0,
      data: {
        packageName: f.job.identifier,
        appType: 1,
        status,
        saleStatus,
        versionName: '2.0',
        versionCode: 20,
      },
    })
  }
  for (const [value, expected] of [
    [1, 'draft'],
    [2, 'in_review'],
    [3, 'published'],
    [4, 'rejected'],
    [5, 'withdrawn'],
    [99, 'unknown'],
  ] as const) {
    status = value
    assert.equal((await queryStoreStatus(f.job, f.store, transport)).versions[0]?.state, expected)
  }
  status = 3
  saleStatus = 2
  assert.equal((await queryStoreStatus(f.job, f.store, transport)).versions[0]?.state, 'removed')
  status = null
  assert.equal((await queryStoreStatus(f.job, f.store, transport)).code, 'invalid_response')
})

test('小米仅固定官方公开页；无需凭据，核对包名和版本，不下载图标或推测审核', async (t) => {
  const f = await fixture(t, 'xiaomi')
  let html =
    '<div>版本号</div><div style="float:right;">2.0.0</div>包名<div class="line-break">com.example.query</div>'
  let calls = 0
  const transport: typeof fetch = async (raw, init) => {
    calls++
    assert.equal(String(raw), 'https://app.mi.com/details?id=com.example.query')
    assert.equal(init?.redirect, 'error')
    assert.equal(init?.method, 'GET')
    assert.equal(init?.headers, undefined)
    return new Response(html)
  }
  const result = await queryStoreStatus(f.job, f.store, transport)
  assert.equal(calls, 1)
  assert.equal(result.code, 'observed')
  assert.equal(result.versions[0]?.versionName, '2.0.0')
  assert.equal(result.versions[0]?.state, 'published')
  html = html.replace('com.example.query', 'com.wrong')
  assert.equal((await queryStoreStatus(f.job, f.store, transport)).code, 'invalid_response')
  html = '公开页结构变化'
  assert.equal((await queryStoreStatus(f.job, f.store, transport)).code, 'invalid_response')
  html = 'x'.repeat(512 * 1024 + 1)
  assert.notEqual((await queryStoreStatus(f.job, f.store, transport)).code, 'observed')
  assert.equal(
    (await queryStoreStatus(f.job, f.store, async () => new Response('', { status: 302 }))).code,
    'network',
  )
})

test('OPPO 只确认有官方依据的“上线”，未知文案与应用级状态不猜审核', async (t) => {
  const f = await fixture(t, 'oppo')
  let description = '上线'
  const transport: typeof fetch = async (raw) =>
    new URL(String(raw)).pathname.endsWith('/token')
      ? Response.json({ errno: 0, data: { access_token: 'synthetic-token' } })
      : Response.json({
          errno: 0,
          data: {
            pkg_name: f.job.identifier,
            type: 7,
            version_name: '2.0',
            version_code: 20,
            state: 1,
            audit_status: 1,
            audit_status_name: description,
          },
        })
  assert.equal((await queryStoreStatus(f.job, f.store, transport)).versions[0]?.state, 'published')
  description = '未核实描述'
  assert.equal((await queryStoreStatus(f.job, f.store, transport)).versions[0]?.state, 'unknown')
})

test('应用宝独立审核接口无版本标识；不得把审核通过绑定到详情旧线上版本', async (t) => {
  const f = await fixture(t, 'tencent')
  let status = 1
  const transport: typeof fetch = async (raw, init) => {
    const path = new URL(String(raw)).pathname
    assert.equal(init?.method, 'POST')
    const params = new URLSearchParams(String(init?.body))
    assert.equal(params.get('app_id'), f.job.binding.appId)
    assert.equal(params.get('pkg_name'), f.job.identifier)
    if (path.endsWith('/query_app_detail'))
      return Response.json({
        ret: 0,
        pkg_name: f.job.identifier,
        app_type: 1,
        VersionName: '1.0',
        VersionCode: 10,
      })
    assert.ok(path.endsWith('/query_app_update_status'))
    return Response.json({ ret: 0, audit_status: status, audit_reason: 'must-not-escape' })
  }
  for (const [value, expected] of [
    [1, 'in_review'],
    [2, 'rejected'],
    [3, 'approved'],
    [8, 'withdrawn'],
    [99, 'unknown'],
  ] as const) {
    status = value
    const result = await queryStoreStatus(f.job, f.store, transport)
    assert.equal(result.code, 'observed')
    assert.deepEqual(
      result.versions.map((v) => [v.versionName, v.state]),
      [
        [null, expected],
        ['1.0', 'unknown'],
      ],
    )
    assert.equal(JSON.stringify(result).includes('must-not-escape'), false)
  }
})
