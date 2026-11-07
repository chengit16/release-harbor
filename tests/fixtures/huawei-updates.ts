/** @description 华为 v2 送审合成现场；网络只由测试替身提供，不接触真实账号。 */
import type test from 'node:test'
import { join } from 'node:path'
import {
  credentialStore,
  profileRevision,
  validateCredentialSubmission,
} from '../../packages/provider-app-ship/src/index.ts'
import { huaweiUpdateSource } from '../../packages/provider-app-ship/src/huawei-material.ts'
import { setup, confirmed } from './release-plans.ts'
import { MemoryCredentialSecrets } from './credential-intake.ts'
import { resign } from './tencent-harmony-execution.ts'

/** 模拟已在架的全网应用，私人字段用于防泄漏断言。 */
export const huaweiSourceResponse = {
  ret: { code: 0 },
  appInfo: {
    releaseState: 0,
    defaultLang: 'zh-CN',
    publishCountry: 'CN',
    onShelfVersionNumber: '1.0.0',
    onShelfVersionCode: 1,
  },
  languages: [
    { lang: 'zh-CN', appName: '合成应用', newFeatures: '原说明' },
    { lang: 'en-US', newFeatures: 'original notes' },
  ],
  auditInfo: { auditOpinion: 'SENSITIVE-VENDOR-TEXT' },
}
const json = (v: unknown) => new Response(JSON.stringify(v))
/** 构建真实文件摘要与内存账号，复用旧草稿现场后显式改为新动作。 */
export async function huaweiFixture(t: test.TestContext) {
  const f = await setup(t, 'android'),
    plan = await confirmed(f),
    vault = join(f.root, 'credentials/profiles.json'),
    credentials = credentialStore(vault, new MemoryCredentialSecrets())
  await credentials.saveProfile({
    credentialProfile: f.binding.credentialReference,
    platform: 'huawei',
    material: validateCredentialSubmission('huawei', {
      displayName: '合成华为账号',
      credentials: { clientId: 'synthetic-client', clientSecret: 'SYNTHETIC-SECRET' },
    }).material,
  })
  const huawei = await huaweiUpdateSource(
    { clientId: 'synthetic-client', token: 'SYNTHETIC-TOKEN' },
    f.application.identifier,
    f.binding.appId,
    async (input) =>
      json(
        String(input).includes('appid-list')
          ? { ret: { code: 0 }, appids: [{ value: f.binding.appId }] }
          : huaweiSourceResponse,
      ),
  )
  Object.assign(plan.snapshot, { action: 'huawei_submit_review', huawei })
  Object.assign(plan.snapshot.preflight, { huawei, profileRevision: await profileRevision(vault) })
  resign(plan)
  return {
    ...f,
    plan,
    vault,
    credentials,
    file: join(f.root, 'artifacts', f.artifact.id, 'payload.apk'),
  }
}
/** 固定网络按阶段返回来源、解析结果及在审结果，任何意外路由直接失败。 */
export function huaweiNetwork(
  f: Awaited<ReturnType<typeof huaweiFixture>>,
  options: {
    sourceChanged?: boolean
    badUrl?: boolean
    badHeaders?: boolean
    wrongVersion?: boolean
    wrongNotes?: boolean
    submitLost?: boolean
    wrongReceipt?: boolean
    parsedState?: number
  } = {},
) {
  const calls: {
    path: string
    method: string
    query: URLSearchParams
    body: unknown
    headers: Headers
  }[] = []
  let permitted = false,
    bound = false,
    submitted = false,
    waited = false
  const transport: typeof fetch = async (input, init) => {
    const u = new URL(String(input)),
      method = init?.method ?? 'GET',
      headers = new Headers(init?.headers),
      body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ path: u.pathname, method, query: u.searchParams, body, headers })
    if (u.pathname.endsWith('/token')) return json({ access_token: 'SYNTHETIC-TOKEN' })
    if (u.hostname.endsWith('.myhuaweicloud.com')) {
      if (!permitted || method !== 'PUT' || headers.get('authorization')?.startsWith('Bearer'))
        throw new Error('上传许可或凭据边界错误')
      return new Response(null)
    }
    if (headers.get('authorization') !== 'Bearer SYNTHETIC-TOKEN') throw new Error('缺鉴权')
    if (u.pathname.endsWith('/appid-list'))
      return json({ ret: { code: 0 }, appids: [{ value: f.binding.appId }] })
    if (u.pathname.endsWith('/app-info'))
      return json(
        bound
          ? {
              ret: { code: 0 },
              appInfo: {
                defaultLang: 'zh-CN',
                versionNumber: f.plan.snapshot.artifact.identity?.versionName,
                versionCode:
                  options.wrongVersion || (submitted && options.wrongReceipt)
                    ? 99
                    : f.plan.snapshot.artifact.identity?.buildNumber,
                releaseState: submitted ? 5 : (options.parsedState ?? 0),
              },
              languages: [
                {
                  lang: 'zh-CN',
                  newFeatures: options.wrongNotes ? 'other' : f.plan.snapshot.releaseNotes,
                },
              ],
            }
          : {
              ...huaweiSourceResponse,
              appInfo: {
                ...huaweiSourceResponse.appInfo,
                onShelfVersionCode: options.sourceChanged ? 2 : 1,
              },
            },
      )
    if (!permitted) throw new Error('写入先于持久化许可')
    if (u.pathname.endsWith('/upload-url/for-obs'))
      return json({
        ret: { code: 0 },
        urlInfo: {
          method: 'PUT',
          objectId: 'app/synthetic.apk',
          url: options.badUrl
            ? 'https://127.0.0.1/app/synthetic.apk'
            : 'https://synthetic.obs.cn-north-4.myhuaweicloud.com/app/synthetic.apk',
          headers: {
            Authorization: options.badHeaders ? 'Bearer STOLEN' : 'AWS4-HMAC-SHA256 synthetic',
            'x-amz-content-sha256': f.plan.snapshot.artifact.sha256,
          },
        },
      })
    if (u.pathname.endsWith('/app-file-info')) {
      bound = true
      return json({ ret: { code: 0 } })
    }
    if (u.pathname.endsWith('/app-language-info')) return json({ ret: { code: 0 } })
    if (u.pathname.endsWith('/app-submit')) {
      if (!waited) throw new Error('未等待解析')
      submitted = true
      if (options.submitLost) throw new Error('SENSITIVE-VENDOR-TEXT')
      return json({ ret: { code: 0 } })
    }
    throw new Error('未声明路由 ' + u.pathname)
  }
  return {
    calls,
    transport,
    permit: () => {
      permitted = true
    },
    wait: async (ms: number) => {
      if (ms !== 120000) throw new Error('等待时长错误')
      waited = true
    },
  }
}
