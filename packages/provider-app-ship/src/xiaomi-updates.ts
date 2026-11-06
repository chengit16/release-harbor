/** @description 小米已有应用的只读更新许可和单次审核提交；固定网络端点，无重定向、重试或原始回执输出。 */
import { constants, createHash, createPublicKey, publicEncrypt } from 'node:crypto'
import { createReadStream, openAsBlob } from 'node:fs'
import type { CredentialProfileStore, CredentialMaterial } from '@huoye/app-ship'
import {
  isRecord,
  isReleasePolicyCurrent,
  type AttemptResult,
  type ExecutionDiagnostic,
} from '@release-harbor/contracts'
import { validateXiaomiUpdateDetails } from '@release-harbor/domain'
import { storeWindowCurrent, type StoreReleaseContext } from './store-release-context.ts'
import { loadXiaomiListing } from './xiaomi-listing.ts'
import type { MerchantCheck } from './credentials.ts'
import { profileRevision } from './credentials.ts'
import { normalizeXiaomiPublicKey, parseXiaomiTestAccount } from './xiaomi-material.ts'

const base = 'https://api.developer.xiaomi.com/devupload/dev/'
const md5 = (data: string | Buffer): string => createHash('md5').update(data).digest('hex')
function signature(
  request: string,
  material: CredentialMaterial,
  files: { name: string; hash: string }[] = [],
): string {
  const key = createPublicKey(normalizeXiaomiPublicKey(material.files?.publicKey?.content ?? ''))
  const password = material.fields.privateKey
  if (!password || !material.fields.userName) throw new Error('材料缺失')
  const raw = Buffer.from(
    JSON.stringify({ sig: [{ name: 'RequestData', hash: md5(request) }, ...files], password }),
  )
  // 平台要求 PKCS#1 v1.5 分段加密；按真实 RSA 位数计算，避免 SDK 固定 117 字节的假设。
  const block = Math.ceil((key.asymmetricKeyDetails?.modulusLength ?? 0) / 8) - 11
  if (block <= 0) throw new Error('公钥格式错误')
  const parts: Buffer[] = []
  for (let offset = 0; offset < raw.length; offset += block)
    parts.push(
      publicEncrypt(
        { key, padding: constants.RSA_PKCS1_PADDING },
        raw.subarray(offset, offset + block),
      ),
    )
  return Buffer.concat(parts).toString('hex')
}
class XiaomiResponseError extends Error {
  constructor(readonly diagnostic: 'upload_http_error' | 'upload_invalid_response') {
    super('商店响应不可用')
  }
}
/** 只提取固定错误类别，绝不公开错误正文、cause 对象或供应商回执。 */
function uploadFailure(error: unknown, signal: AbortSignal): ExecutionDiagnostic {
  const reason: unknown = signal.aborted ? signal.reason : error
  const name = isRecord(reason) ? reason.name : undefined
  const cause = isRecord(reason) && isRecord(reason.cause) ? reason.cause.code : undefined
  if (
    name === 'TimeoutError' ||
    [
      'UND_ERR_CONNECT_TIMEOUT',
      'UND_ERR_HEADERS_TIMEOUT',
      'UND_ERR_BODY_TIMEOUT',
      'ETIMEDOUT',
    ].includes(typeof cause === 'string' ? cause : '')
  )
    return 'upload_timeout'
  if (name === 'AbortError') return 'upload_aborted'
  if (error instanceof XiaomiResponseError) return error.diagnostic
  return 'upload_network_error'
}
async function responseJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) throw new XiaomiResponseError('upload_http_error')
  if (!response.body) throw new XiaomiResponseError('upload_invalid_response')
  const parts: Uint8Array[] = []
  let size = 0
  const reader = response.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > 64 * 1024) {
        await reader.cancel()
        throw new XiaomiResponseError('upload_invalid_response')
      }
      parts.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  let data: unknown
  try {
    data = JSON.parse(Buffer.concat(parts).toString('utf8'))
  } catch {
    throw new XiaomiResponseError('upload_invalid_response')
  }
  if (!isRecord(data)) throw new XiaomiResponseError('upload_invalid_response')
  return data
}
async function query(
  material: CredentialMaterial,
  identifier: string,
  transport: typeof fetch,
  expectedName?: string,
): Promise<MerchantCheck & { appName?: string }> {
  let authentication: MerchantCheck['authentication'] = 'unverified'
  const result = (code: MerchantCheck['code']): MerchantCheck => ({
    code,
    authentication,
    target: code === 'verified' ? 'passed' : 'unverified',
  })
  // 1. 只构造目标查询签名，不携带测试登录材料。
  let body: FormData
  try {
    const request = JSON.stringify({ userName: material.fields.userName, packageName: identifier })
    body = new FormData()
    body.set('RequestData', request)
    body.set('SIG', signature(request, material))
  } catch {
    return result('invalid_credentials')
  }
  try {
    // 2. 固定只读端点、期限及响应预算，绝不跟随重定向。
    const response = await transport(base + 'query', {
      method: 'POST',
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    })
    if (response.status === 401 || response.status === 403) return result('rejected')
    const data = await responseJson(response)
    if (!Number.isInteger(data.result)) return result('invalid_response')
    if (data.result !== 0)
      return result(
        data.result === -20035
          ? 'query_rate_limited'
          : data.result === -20014
            ? 'invalid_credentials'
            : data.result === -7
              ? 'application_mismatch'
              : 'rejected',
      )
    // 3. 鉴权成功仍须匹配包名、名称（执行时）及明确的版本更新许可。
    authentication = 'passed'
    if (!isRecord(data.packageInfo)) return result('application_not_found')
    if (typeof data.packageInfo.packageName !== 'string') return result('invalid_response')
    if (data.packageInfo.packageName !== identifier) return result('application_mismatch')
    if (expectedName !== undefined && data.packageInfo.appName !== expectedName)
      return result('application_mismatch')
    if (
      typeof data.updateVersion !== 'boolean' ||
      ['create', 'updateInfo'].some((k) => data[k] !== undefined && typeof data[k] !== 'boolean') ||
      data.create === true
    )
      return result('invalid_response')
    return {
      ...result(data.updateVersion ? 'verified' : 'application_not_ready'),
      ...(typeof data.packageInfo.appName === 'string'
        ? { appName: data.packageInfo.appName }
        : {}),
    }
  } catch (error) {
    return result(error instanceof XiaomiResponseError ? 'invalid_response' : 'network_unavailable')
  }
}
/** 查询仅发送开发者邮箱、包名与加密签名，不发送测试账号，不探测提交端点。 */
export async function checkXiaomiUpdate(
  reference: string,
  identifier: string,
  appId: string,
  store: CredentialProfileStore,
  transport: typeof fetch = fetch,
  includeMaterials = false,
): Promise<MerchantCheck> {
  if (appId !== identifier)
    return { code: 'application_mismatch', authentication: 'unverified', target: 'unverified' }
  let material: CredentialMaterial
  try {
    material = await store.resolveForLocalExecution({
      credentialProfile: reference,
      platform: 'xiaomi',
      purpose: 'verify',
    })
  } catch {
    return { code: 'credentials_unavailable', authentication: 'unverified', target: 'unverified' }
  }
  const { appName, ...result } = await query(material, identifier, transport)
  if (!includeMaterials || result.code !== 'verified') return result
  try {
    if (!appName) throw new Error('缺少商店名称')
    return { ...result, xiaomi: await loadXiaomiListing(identifier, appName, transport) }
  } catch {
    return { ...result, code: 'store_materials_unavailable', target: 'unverified' }
  }
}
/** 只由已复核副本的 worker 调用；许可前完成材料、字节、目标检查，许可后结果不明一律不重试；report 仅输出固定阶段码，不能附带供应商正文或材料。 */
export async function submitXiaomiUpdate(
  plan: StoreReleaseContext,
  file: string,
  vaultPath: string,
  beforeRemote: () => Promise<void>,
  store: CredentialProfileStore,
  transport: typeof fetch = fetch,
  report: (code: ExecutionDiagnostic) => void = () => undefined,
): Promise<AttemptResult> {
  // 1. 动作与资料固定；测试账号仅在可信内存解析，不放入公开快照。
  const s = plan.snapshot
  if (
    !s.releasePolicy ||
    !isReleasePolicyCurrent(s.releasePolicy, Date.now()) ||
    s.action !== 'xiaomi_submit_review' ||
    s.binding.channel !== 'xiaomi' ||
    s.binding.appId !== s.application.identifier
  )
    return 'verification_failed'
  report('xiaomi_submission_validation')
  const details = validateXiaomiUpdateDetails(s.xiaomi)
  report('profile_changed')
  const material = await store.resolveForLocalExecution({
    credentialProfile: s.binding.credentialReference,
    platform: 'xiaomi',
    purpose: 'release_execution',
  })
  report('xiaomi_test_materials')
  const testAccount = parseXiaomiTestAccount(material.fields.testAccountJson ?? '')
  report('merchant_unavailable')
  const target = await query(material, s.application.identifier, transport, details.appName)
  if (target.code !== 'verified') {
    report(
      target.code === 'query_rate_limited'
        ? 'merchant_rate_limited'
        : ['invalid_credentials', 'credentials_unavailable', 'rejected'].includes(target.code)
          ? 'merchant_authentication'
          : ['application_mismatch', 'application_not_found', 'application_not_ready'].includes(
                target.code,
              )
            ? 'merchant_target'
            : 'merchant_unavailable',
    )
    return 'verification_failed'
  }
  const request = JSON.stringify({
    userName: material.fields.userName,
    synchroType: 1,
    appInfo: {
      appName: details.appName,
      packageName: s.application.identifier,
      updateDesc: s.releaseNotes,
      privacyUrl: details.privacyUrl,
      testAccount: JSON.stringify(testAccount),
      ...(s.releasePolicy.mode === 'scheduled'
        ? { onlineTime: Date.parse(s.releasePolicy.notBefore) }
        : {}),
    },
  })
  // 2. 对真实副本计算上传签名；PNG 已匹配固定摘要，文件 Blob 在独立副本生命周期内消费。
  report('artifact_invalid')
  const hash = createHash('md5'),
    sha = createHash('sha256')
  let size = 0
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk)
    sha.update(chunk)
    size += chunk.length
  }
  if (size !== s.artifact.sizeBytes || sha.digest('hex') !== s.artifact.sha256)
    return 'verification_failed'
  report('sdk_preparation')
  const icon = Buffer.from(details.iconBase64, 'base64')
  const body = new FormData()
  body.set('RequestData', request)
  body.set(
    'SIG',
    signature(request, material, [
      { name: 'apk', hash: hash.digest('hex') },
      { name: 'icon', hash: md5(icon) },
    ]),
  )
  body.set('apk', await openAsBlob(file), 'payload.apk')
  body.set('icon', new Blob([icon], { type: 'image/png' }), 'icon.png')
  report('authorization_changed')
  if (
    !isReleasePolicyCurrent(s.releasePolicy, Date.now()) ||
    !storeWindowCurrent(plan) ||
    (await profileRevision(vaultPath)) !== s.preflight.profileRevision
  )
    return 'verification_failed'
  // 3. 只有父进程持久化许可后单次提交；不使用 SDK 自动新增／更新判断及自动重试。
  await beforeRemote()
  if (!isReleasePolicyCurrent(s.releasePolicy, Date.now())) {
    report('remote_unknown')
    return 'needs_reconciliation'
  }
  const signal = AbortSignal.timeout(120000)
  try {
    const data = await responseJson(
      await transport(base + 'push', {
        method: 'POST',
        body,
        redirect: 'error',
        signal,
      }),
    )
    if (data.result === 0) return 'review_submitted'
    report(Number.isInteger(data.result) ? 'upload_rejected' : 'upload_invalid_response')
    return 'needs_reconciliation'
  } catch (error) {
    // 许可后的具体传输原因必须保留，但不能据此自动重试或声称零写入。
    report(uploadFailure(error, signal))
    return 'needs_reconciliation'
  }
}
