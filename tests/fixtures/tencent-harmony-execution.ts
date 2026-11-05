/** @description 应用宝／鸿蒙测试的隔离执行现场和固定网络，禁止使用真实账号或真实 fetch。 */
import type test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { ReleasePlan } from '../../packages/contracts/src/index.ts'
import { setup, confirmed } from './release-plans.ts'
import { MemoryCredentialSecrets } from './credential-intake.ts'
import { tencentCredentials, harmonyCredentials } from './tencent-harmony.ts'
import { syntheticApk } from './apk.ts'
import { syntheticHarmony } from './harmony.ts'
import {
  credentialStore,
  profileRevision,
  validateCredentialSubmission,
  inspectLocalArtifact,
} from '../../packages/provider-app-ship/src/index.ts'
import { planFingerprint, configurationFingerprint } from '../../packages/domain/src/index.ts'
import { tencentSignature } from '../../packages/provider-app-ship/src/tencent-harmony-client.ts'
/** 注入网络的完整调用事实和本地许可开关，不返回原始商店秘密。 */
interface ChannelNetwork {
  transport: typeof fetch
  calls: { path: string; method: string; body: Record<string, unknown> }[]
  readonly writes: number
  permit(): void
}
type Channel = 'tencent' | 'harmony'
/** 真实合成文件与内存材料构建完整执行计划，始终使用隔离目录。 */
export async function fixture(
  t: test.TestContext,
  channel: Channel,
): Promise<
  Awaited<ReturnType<typeof setup>> & {
    plan: ReleasePlan
    vault: string
    credentials: ReturnType<typeof credentialStore>
    file: string
    channel: Channel
  }
> {
  const f = await setup(t, channel === 'harmony' ? 'harmony' : 'android', undefined, { channel }),
    plan = await confirmed(f),
    vault = join(f.root, 'credentials/profiles.json'),
    secrets = new MemoryCredentialSecrets(),
    credentials = credentialStore(vault, secrets)
  const input = validateCredentialSubmission(channel, {
    displayName: '合成账号',
    credentials: channel === 'tencent' ? tencentCredentials : harmonyCredentials,
  })
  await credentials.saveProfile({
    credentialProfile: f.binding.credentialReference,
    platform: channel,
    material: input.material,
  })
  const bytes =
    channel === 'tencent' ? await syntheticApk(f.root) : syntheticHarmony(f.application.identifier)
  assert.ok(bytes)
  const file = join(
    f.root,
    'artifacts',
    f.artifact.id,
    `payload.${channel === 'harmony' ? 'app' : 'apk'}`,
  )
  await writeFile(file, bytes)
  const identity = await inspectLocalArtifact(file),
    s = plan.snapshot
  Object.assign(s.artifact, {
    sha256: identity.sha256,
    sizeBytes: bytes.length,
    expectedSizeBytes: bytes.length,
    identity,
  })
  s.preflight.artifactSha256 = identity.sha256
  s.preflight.profileRevision = await profileRevision(vault)
  resign(plan)
  return { ...f, plan, vault, credentials, file, channel }
}
/** 测试修改合成产物后重新计算真实公开快照指纹，不伪造生产授权。 */
export function resign(plan: Awaited<ReturnType<typeof confirmed>>): void {
  plan.snapshot.configDigest = configurationFingerprint(plan.snapshot)
  plan.digest = planFingerprint(plan.snapshot)
  assert.ok(plan.authorization)
  plan.authorization.planDigest = plan.digest
}
const json = (v: unknown) => new Response(JSON.stringify(v))
/** 固定网关替身记录每次写入，任何意外路由均失败，不能落到真实 fetch。 */
export function network(
  f: Awaited<ReturnType<typeof fixture>>,
  options: {
    sourceChanged?: boolean
    rejectQuery?: boolean
    badUrl?: boolean
    submitLost?: boolean
    parse?: number
    wrongPackage?: boolean
    wrongNotes?: boolean
  } = {},
): ChannelNetwork {
  const calls: { path: string; method: string; body: Record<string, unknown> }[] = [],
    notes = new Map<string, string>()
  let permit = false,
    writes = 0
  const transport: typeof fetch = async (input, init) => {
    const u = new URL(String(input)),
      method = init?.method ?? 'GET'
    let body: Record<string, unknown> = {}
    if (init?.body instanceof URLSearchParams) body = Object.fromEntries(init.body)
    else if (typeof init?.body === 'string') body = JSON.parse(init.body)
    calls.push({ path: u.pathname, method, body })
    const readonly =
      u.pathname.endsWith('/token') ||
      u.pathname.endsWith('/appid-list') ||
      u.pathname.endsWith('/app-info') ||
      u.pathname.endsWith('/status') ||
      u.pathname.endsWith('/query_app_detail') ||
      u.pathname.endsWith('/query_app_update_status') ||
      u.pathname.endsWith('/v2/app-package-info')
    if (!readonly) {
      assert.ok(permit, '远端写入先于许可')
      writes++
    }
    if (u.hostname === 'p.open.qq.com') {
      assert.equal(method, 'POST')
      assert.equal(body.app_id, f.binding.appId)
      assert.equal(body.pkg_name, f.application.identifier)
      const params = Object.fromEntries(
        Object.entries(body)
          .filter(([k]) => k !== 'sign')
          .map(([k, v]) => [k, String(v)]),
      )
      assert.equal(body.sign, tencentSignature(params, tencentCredentials.accessSecret))
      if (u.pathname.endsWith('/query_app_detail'))
        return json(
          options.rejectQuery
            ? { ret: -1, msg: 'SENSITIVE-VENDOR-TEXT' }
            : {
                ret: 0,
                pkg_name: f.application.identifier,
                app_type: 1,
                app_name: options.sourceChanged ? '已变化' : '合成应用',
                VersionName: '0.0.1',
                VersionCode: 1,
                login_account: 'DO-NOT-PROJECT',
                apk32_file_serial_number: 'STALE-SERIAL',
              },
        )
      if (u.pathname.endsWith('/get_file_upload_info'))
        return json({
          ret: 0,
          pre_sign_url: options.badUrl
            ? 'https://127.0.0.1/upload'
            : 'https://synthetic.cos.ap-guangzhou.myqcloud.com/payload.apk',
          serial_number: 'synthetic-new-upload',
        })
      if (u.pathname.endsWith('/update_app')) {
        if (options.submitLost) throw new Error('SENSITIVE-VENDOR-TEXT')
        return json({ ret: 0 })
      }
    }
    if (u.hostname.endsWith('.myqcloud.com')) {
      assert.equal(method, 'PUT')
      assert.ok(init?.body instanceof Blob)
      assert.equal(init.headers && new Headers(init.headers).get('authorization'), null)
      return new Response(null)
    }
    if (u.pathname.endsWith('/token')) return json({ access_token: 'SYNTHETIC-TOKEN' })
    const ok = { ret: { code: 0 } }
    if (u.pathname.endsWith('/appid-list')) {
      assert.equal(u.searchParams.get('packageTypes'), '7')
      return json({ ...ok, appids: [{ value: f.binding.appId }] })
    }
    if (u.pathname.endsWith('/app-info'))
      return json({
        ...ok,
        appInfo: {
          releaseState: 0,
          versionNumber: '0.0.1',
          versionCode: 1,
          defaultLang: 'zh-CN',
          releasePhase: 0,
          testUserPassword: 'DO-NOT-PROJECT',
        },
        languages: [
          {
            lang: 'zh-CN',
            appName: options.sourceChanged ? '已变化' : '合成应用',
            newFeatures: options.wrongNotes ? 'other' : notes.get('zh-CN'),
          },
        ],
      })
    if (u.pathname.endsWith('/multipart/init'))
      return json({
        ...ok,
        objectId: 'synthetic-object',
        nspUploadId: 'synthetic-upload',
        nspPartMinSize: 5242880,
        nspPartMaxSize: 104857600,
      })
    if (u.pathname.endsWith('/multipart/parts')) {
      const bytes = await readFile(f.file),
        info: Record<string, unknown> = {}
      for (const [key, d] of Object.entries(body)) {
        assert.ok(typeof d === 'object' && d !== null && 'sha256' in d && 'length' in d)
        const index = Number(key.replace('additionalProp', '')) - 1,
          part = bytes.subarray(index * 5242880, Math.min(bytes.length, (index + 1) * 5242880))
        assert.equal(d.sha256, createHash('sha256').update(part).digest('hex'))
        assert.equal(d.length, part.length)
        info[key] = {
          url: options.badUrl
            ? 'https://evil.example/file'
            : `https://synthetic.obs.cn-north-4.myhuaweicloud.com/payload?partNumber=${index + 1}`,
          method: 'PUT',
          partObjectId: '',
          headers: JSON.stringify({
            'Content-Type': 'application/octet-stream',
            'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
            'Content-Length': String(part.length),
          }),
        }
      }
      return json({ ...ok, uploadInfoMap: info })
    }
    if (u.hostname.endsWith('.myhuaweicloud.com')) {
      assert.ok(init?.body instanceof Blob)
      const partNumber = Number(u.searchParams.get('partNumber')),
        bytes = await readFile(f.file),
        expected = bytes.subarray(
          (partNumber - 1) * 5242880,
          Math.min(bytes.length, partNumber * 5242880),
        )
      assert.deepEqual(Buffer.from(await init.body.arrayBuffer()), expected)
      assert.equal(new Headers(init.headers).get('content-length'), String(expected.length))
      return new Response(null, { headers: { etag: `"synthetic-etag-${partNumber}"` } })
    }
    if (u.pathname.endsWith('/multipart/compose')) {
      const count = Math.ceil(f.plan.snapshot.artifact.sizeBytes / 5242880),
        expected = Object.fromEntries(
          Array.from({ length: count }, (_, i) => [
            `additionalProp${i + 1}`,
            { partObjectId: '', etag: `"synthetic-etag-${i + 1}"` },
          ]),
        )
      assert.deepEqual(body, expected)
      return json(ok)
    }
    if (u.pathname.endsWith('/v3/app-package-info')) return json({ ...ok, packageId: '987654' })
    if (u.pathname.endsWith('/compile/status'))
      return json({ ...ok, pkgStateList: [{ pkgId: '987654', successStatus: options.parse ?? 0 }] })
    if (u.pathname.endsWith('/v2/app-package-info')) {
      assert.equal(new Headers(init?.headers).get('appId'), f.binding.appId)
      return json({
        ...ok,
        packageInfo: {
          packageId: options.wrongPackage ? '111' : '987654',
          fileName: 'payload.app',
          versionCode: 42,
          versionName: '1.2.3',
        },
      })
    }
    if (u.pathname.endsWith('/app-language-info')) {
      assert.deepEqual(Object.keys(body).sort(), ['lang', 'newFeatures'])
      notes.set(String(body.lang), String(body.newFeatures))
      return json(ok)
    }
    if (u.pathname.endsWith('/app-submit')) {
      if (options.submitLost) throw new Error('SENSITIVE-VENDOR-TEXT')
      return json(ok)
    }
    assert.fail('未声明路由 ' + u.pathname)
  }
  return {
    transport,
    calls,
    get writes() {
      return writes
    },
    permit() {
      permit = true
    },
  }
}
