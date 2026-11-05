/** @description 本机凭据目录及只读商店适配，仅可信 CLI／worker 可加载 SDK 和解密材料。 */
import { createHash } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import {
  LocalCredentialProfileStore,
  preflightPublish,
  type CredentialProfileStore,
  type SecretStore,
} from '@huoye/app-ship'
import {
  isProfileReference,
  type ProfileCatalog,
  type BindingChannel,
  type PreflightRecord,
} from '@release-harbor/contracts'
import { checkStoreUpdate } from './store-preflight.ts'
import { checkVivoUpdate } from './vivo-updates.ts'
import { checkOppoUpdate } from './oppo-updates.ts'
import { checkXiaomiUpdate } from './xiaomi-updates.ts'
import { NativeKeychainSecrets } from './keychain.ts'

/** 只读动作返回允许字段，绝不把 SDK 对象直接传给控制面。 */
export type MerchantCheck = Pick<
  PreflightRecord,
  'code' | 'authentication' | 'target' | 'xiaomi' | 'oppo' | 'vivo' | 'meizu' | 'honor'
>

/** 必须显式指定本产品目录；测试传入内存安全库，不能碰真实 Keychain。 */
export function credentialStore(vaultPath: string, secrets?: SecretStore): CredentialProfileStore {
  if (!secrets && process.platform !== 'darwin') throw new Error('当前环境不支持安全凭据存储')
  return new LocalCredentialProfileStore(secrets ?? new NativeKeychainSecrets(), vaultPath)
}

/** 目录文件每次替换都会换版本；不读取、哈希或输出秘密和密文内容。 */
export async function profileRevision(vaultPath: string): Promise<string> {
  try {
    const stat = await lstat(vaultPath, { bigint: true })
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('不支持的凭据文件')
    return createHash('sha256')
      .update([stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':'))
      .digest('hex')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return '0'.repeat(64)
    throw error
  }
}

/** 只读元数据无需解密；前后版本不同则拒绝发布可能混合的目录快照。 */
export async function profileCatalog(
  vaultPath: string,
  store?: CredentialProfileStore,
): Promise<ProfileCatalog> {
  if (!store && process.platform !== 'darwin')
    return { code: 'unsupported_environment', profiles: [] }
  try {
    const revision = await profileRevision(vaultPath)
    const metadata = await (store ?? credentialStore(vaultPath)).listMetadata()
    if (revision !== (await profileRevision(vaultPath))) throw new Error('目录已变化')
    return {
      code: 'available',
      profiles: metadata.flatMap((p) =>
        isProfileReference(p.credentialProfile) &&
        (p.platform === 'huawei' ||
          p.platform === 'app_store' ||
          p.platform === 'xiaomi' ||
          p.platform === 'oppo' ||
          p.platform === 'vivo' ||
          p.platform === 'meizu' ||
          p.platform === 'honor')
          ? [
              {
                reference: p.credentialProfile,
                channel: p.platform,
                configured: p.configured,
                revision,
              },
            ]
          : [],
      ),
    }
  } catch {
    return { code: 'storage_unavailable', profiles: [] }
  }
}

/** SDK 的请求仍受产品白名单限制；仅允许鉴权及应用查询，不重定向或自动重试。 */
export function readonlyTransport(
  channel: BindingChannel,
  transport: typeof fetch = fetch,
): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const allowed =
      channel === 'huawei'
        ? url.origin === 'https://connect-api.cloud.huawei.com' &&
          ((url.pathname === ['/api', 'oauth2', 'v1', 'token'].join('/') && method === 'POST') ||
            (url.pathname === '/api/publish/v2/appid-list' && method === 'GET'))
        : channel === 'app_store' &&
          url.origin === 'https://api.appstoreconnect.apple.com' &&
          url.pathname === '/v1/apps' &&
          method === 'GET'
    if (!allowed || url.username || url.password || url.hash) throw new Error('不允许的只读请求')
    return transport(input, { ...init, redirect: 'error' })
  }
}

/** 仅在产物及 Profile 版本已核对后调用；鉴权成功不能投影为上传权限通过。 */
export async function checkMerchant(
  input: { channel: BindingChannel; reference: string; identifier: string; appId: string },
  store: CredentialProfileStore,
  transport?: typeof fetch,
  includeXiaomiMaterials = false,
): Promise<MerchantCheck> {
  if (input.channel === 'meizu' || input.channel === 'honor')
    return checkStoreUpdate(
      input.channel,
      input.reference,
      input.identifier,
      input.appId,
      store,
      transport,
    )
  if (input.channel === 'vivo')
    return checkVivoUpdate(input.reference, input.identifier, input.appId, store, transport)
  if (input.channel === 'oppo')
    return checkOppoUpdate(input.reference, input.identifier, input.appId, store, transport)
  if (input.channel === 'xiaomi')
    return checkXiaomiUpdate(
      input.reference,
      input.identifier,
      input.appId,
      store,
      transport,
      includeXiaomiMaterials,
    )
  const result = await preflightPublish(
    {
      platform: input.channel,
      credentialProfile: input.reference,
      packageName: input.identifier,
      appId: input.appId,
    },
    store,
    undefined,
    readonlyTransport(input.channel, transport),
  )
  const verified =
    result.verified &&
    result.code === 'verified' &&
    result.authentication === 'verified' &&
    result.application === 'matched' &&
    result.appId === input.appId
  return {
    code: verified ? 'verified' : result.code === 'verified' ? 'invalid_response' : result.code,
    authentication: result.authentication === 'verified' ? 'passed' : 'unverified',
    target: verified ? 'passed' : 'unverified',
  }
}
