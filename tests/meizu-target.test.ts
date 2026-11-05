/** @description 魅族修改审核状态回归；仅内存凭据与固定只读响应，防止 -1 误拦截及待审状态误放行。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkMerchant, credentialStore } from '../packages/provider-app-ship/src/index.ts'
import { MemoryCredentialSecrets } from './fixtures/credential-intake.ts'
import { meizuApp, storeCredentials } from './fixtures/store-updates.ts'

test('魅族只读核验兼容已上架来源的 -1，并保留待审与未知状态保护', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'harbor-meizu-state-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = credentialStore(join(root, 'profiles.json'), new MemoryCredentialSecrets())
  await store.saveProfile({
    credentialProfile: 'synthetic-meizu',
    platform: 'meizu',
    material: { fields: storeCredentials },
  })
  const cases: [Record<string, unknown>, Record<string, unknown>, string][] = [
    [{ replaceStatus: -1 }, {}, 'verified'],
    [{}, {}, 'verified'],
    [{ replaceStatus: null }, {}, 'verified'],
    [{ replaceStatus: 0 }, {}, 'meizu_pending_changes'],
    [{ replaceStatus: 1 }, {}, 'meizu_pending_changes'],
    [{ replaceStatus: 2 }, {}, 'store_source_invalid'],
    [{ replaceStatus: '-1' }, {}, 'store_source_invalid'],
    [{ replaceStatus: false }, {}, 'store_source_invalid'],
    [{ status: 20, replaceStatus: -1 }, {}, 'meizu_not_on_shelf'],
    [{ status: 100 }, {}, 'meizu_not_on_shelf'],
    [{ status: '50' }, {}, 'meizu_not_on_shelf'],
    [{ replaceStatus: -1 }, { status: 100 }, 'meizu_not_on_shelf'],
    [{ replaceStatus: -1 }, { packageName: 'com.example.other' }, 'application_mismatch'],
    [{ replaceStatus: -1 }, { verId: 999 }, 'application_mismatch'],
    [{ replaceStatus: -1 }, { recommendDesc: '' }, 'meizu_recommendation_missing'],
    [{ replaceStatus: -1 }, { recommendDesc: '   ' }, 'meizu_recommendation_missing'],
    [{ replaceStatus: -1 }, { recommendDesc: null }, 'meizu_recommendation_missing'],
    [{ replaceStatus: -1 }, { replaceStatus: 0 }, 'meizu_pending_changes'],
  ]
  for (const [list, detail, code] of cases) {
    await t.test(
      `列表 ${JSON.stringify(list)}、详情 ${JSON.stringify(detail)} → ${code}`,
      async () => {
        const calls: string[] = []
        const transport: typeof fetch = async (input, init) => {
          const url = new URL(String(input))
          assert.equal(url.origin, 'https://developer.meizu.com')
          assert.equal(init?.method ?? 'GET', 'GET')
          const route = url.pathname.split('/').at(-1) ?? ''
          calls.push(route)
          let value: unknown
          if (route === 'token') value = { accessToken: 'synthetic-token' }
          else if (route === 'list')
            value = {
              total: 1,
              data: [
                { id: 123456, verId: 100, pkgName: 'com.example.android', status: 50, ...list },
              ],
            }
          else {
            assert.equal(route, 'detail')
            assert.equal(url.searchParams.get('verId'), '100')
            value = { ...meizuApp(), ...detail }
          }
          return new Response(JSON.stringify({ code: 200, value }))
        }
        const result = await checkMerchant(
          {
            channel: 'meizu',
            reference: 'synthetic-meizu',
            identifier: 'com.example.android',
            appId: '123456',
          },
          store,
          transport,
        )
        assert.equal(result.code, code)
        assert.equal(result.authentication, 'passed')
        assert.equal(result.target, code === 'verified' ? 'passed' : 'unverified')
        assert.ok(calls.every((route) => ['token', 'list', 'detail'].includes(route)))
        assert.ok(!JSON.stringify(result).includes('private-'))
        assert.ok(!JSON.stringify(result).includes(storeCredentials.clientSecret))
      },
    )
  }
})
