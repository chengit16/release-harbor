/** @description 华为 Android v2 单 APK 更新送审；写入在同一次授权内执行且绝不重试。 */
import { openAsBlob } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import type { CredentialProfileStore } from '@huoye/app-ship'
import {
  isRecord,
  sameHuaweiUpdateDetails,
  type AttemptResult,
  type ExecutionDiagnostic,
} from '@release-harbor/contracts'
import type { StoreReleaseContext } from './store-release-context.ts'
import { verifyStoreArtifact, verifyStoreWindow } from './store-execution.ts'
import { StoreRequestError, storeScalar } from './store-client.ts'
import { harmonyRequest, harmonySession } from './tencent-harmony-client.ts'
import { huaweiUpdateSource } from './huawei-material.ts'
import { releaseUtcTime } from './release-time.ts'

/** 仅可信测试可替换网络和等待；HTTP/worker 输入不能选择这些端口。 */
export interface HuaweiUpdatePorts {
  /** 省略时使用固定路由上的真实 fetch；仅隔离测试可注入。 */
  transport?: typeof fetch
  /** 等待单位为毫秒，生产使用可中断的 Node 定时器。 */
  wait?: (milliseconds: number) => Promise<void>
  /** 仅回报白名单诊断，不回传上游正文或签名地址。 */
  report?: (code: ExecutionDiagnostic) => void
}

function isHuaweiObsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 16384) return false
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.hash &&
      !url.port &&
      /^[a-z0-9-]+\.obs\.[a-z0-9-]+\.(myhuaweicloud\.com|huaweicloud\.com)$/.test(url.hostname)
    )
  } catch {
    return false
  }
}

function uploadHeaders(
  value: unknown,
  url: string,
  size: number,
  sha256: string,
): Record<string, string> | null {
  if (!isRecord(value) || Object.keys(value).length > 12) return null
  const allowed = new Set([
    'authorization',
    'x-amz-content-sha256',
    'x-amz-date',
    'content-type',
    'user-agent',
    'host',
    'content-length',
  ])
  const output: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (
      !allowed.has(key.toLowerCase()) ||
      typeof item !== 'string' ||
      !item ||
      item.length > 4096 ||
      /[\r\n\x00]/.test(item) ||
      (key.toLowerCase() === 'authorization' &&
        !item.startsWith('AWS4-HMAC-SHA256 ') &&
        !item.startsWith('OBS ')) ||
      (key.toLowerCase() === 'host' && item !== new URL(url).host) ||
      (key.toLowerCase() === 'content-length' && item !== String(size)) ||
      // 官方存储可采用不签正文的方式；获取地址时仍携带冻结 SHA，且本机已独立核验实际字节。
      (key.toLowerCase() === 'x-amz-content-sha256' &&
        item !== sha256 &&
        item !== 'UNSIGNED-PAYLOAD')
    )
      return null
    // Fetch 由运行时生成 Host 与 Content-Length；其余签名字段必须原样保留。
    if (!['host', 'content-length'].includes(key.toLowerCase())) output[key] = item
  }
  return Object.keys(output).length >= 2 ? output : null
}

/**
 * 一次确认覆盖文件、默认语言更新及送审；平台解析不足两分钟时绝不提前提交。
 * 长函数保留原因：顺序协议共享单次许可和结果不明边界；读写步骤不可独立重放。
 */
export async function submitHuaweiUpdate(
  plan: StoreReleaseContext,
  file: string,
  vaultPath: string,
  beforeRemote: () => Promise<void>,
  store: CredentialProfileStore,
  ports: HuaweiUpdatePorts = {},
): Promise<AttemptResult> {
  const snapshot = plan.snapshot,
    transport = ports.transport ?? fetch,
    wait = ports.wait ?? delay
  let remote = false,
    stage: ExecutionDiagnostic = 'store_submission_validation'
  try {
    if (
      snapshot.action !== 'huawei_submit_review' ||
      snapshot.binding.channel !== 'huawei' ||
      !snapshot.huawei ||
      !snapshot.releasePolicy ||
      snapshot.releasePolicy.mode === 'manual' ||
      !snapshot.artifact.identity ||
      !/^\d{1,18}$/.test(snapshot.artifact.identity.buildNumber) ||
      snapshot.releaseNotes.length > 1000
    )
      return 'verification_failed'
    stage = 'profile_changed'
    const material = await store.resolveForLocalExecution({
      credentialProfile: snapshot.binding.credentialReference,
      platform: 'huawei',
      purpose: 'release_execution',
    })
    const session = await harmonySession(material.fields, transport)
    stage = 'merchant_unavailable'
    const current = await huaweiUpdateSource(
      session,
      snapshot.application.identifier,
      snapshot.binding.appId,
      transport,
    )
    if (!sameHuaweiUpdateDetails(current, snapshot.huawei))
      throw new StoreRequestError('store_source_changed')
    if (BigInt(snapshot.artifact.identity.buildNumber) <= BigInt(current.sourceVersionCode))
      throw new StoreRequestError('store_version_invalid')

    // 1. 许可前复核字节、账号和冻结期限；获取签名上传地址已可能建立平台侧状态。
    stage = 'artifact_invalid'
    await verifyStoreArtifact(plan, file)
    await verifyStoreWindow(plan, vaultPath, true)
    await beforeRemote()
    remote = true
    stage = 'remote_unknown'

    // 2. 仅向官方 v2 固定路由取短期 OBS 地址，上传时不附带 OAuth 凭据。
    const uploadInfo = await harmonyRequest(
      session,
      'androidUploadUrl',
      {
        appId: snapshot.binding.appId,
        fileName: 'payload.apk',
        sha256: snapshot.artifact.sha256 ?? '',
        contentLength: String(snapshot.artifact.sizeBytes),
        releaseType: '1',
      },
      undefined,
      transport,
    )
    const info = uploadInfo.urlInfo
    if (
      !isRecord(info) ||
      !isHuaweiObsUrl(info.url) ||
      info.method !== 'PUT' ||
      typeof info.objectId !== 'string' ||
      !/^[A-Za-z0-9/_-][A-Za-z0-9/_.-]{0,1023}\.apk$/.test(info.objectId) ||
      info.objectId.includes('..') ||
      decodeURIComponent(new URL(info.url).pathname).replace(/^\//, '') !== info.objectId
    )
      throw new StoreRequestError('store_upload_mismatch')
    const headers = uploadHeaders(
      info.headers,
      info.url,
      snapshot.artifact.sizeBytes,
      snapshot.artifact.sha256 ?? '',
    )
    if (!headers) throw new StoreRequestError('store_upload_mismatch')
    await verifyStoreWindow(plan, vaultPath)
    const signal = AbortSignal.timeout(300000)
    const response = await transport(info.url, {
      method: 'PUT',
      headers,
      body: await openAsBlob(file),
      signal,
      redirect: 'error',
    }).catch(() => {
      throw new StoreRequestError(signal.aborted ? 'upload_timeout' : 'upload_network_error')
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new StoreRequestError('upload_http_error')
    }

    await response.body?.cancel()

    // 3. 更新软件包与默认语言说明，不覆盖其它语言、图标、隐私资料或商店元数据。
    await verifyStoreWindow(plan, vaultPath)
    await harmonyRequest(
      session,
      'androidFileInfo',
      { appId: snapshot.binding.appId, releaseType: '1' },
      {
        fileType: 5,
        files: [{ fileName: 'payload.apk', fileDestUrl: info.objectId }],
      },
      transport,
    )
    await verifyStoreWindow(plan, vaultPath)
    await harmonyRequest(
      session,
      'androidLanguage',
      { appId: snapshot.binding.appId, releaseType: '1' },
      { lang: snapshot.huawei.defaultLang, newFeatures: snapshot.releaseNotes },
      transport,
    )

    // 4. Huawei 文档要求传包后等待至少两分钟；等待中止或账号变化时不重传、不继续送审。
    await wait(120000)
    await verifyStoreWindow(plan, vaultPath)
    const parsed = await harmonyRequest(
      session,
      'androidInfo',
      { appId: snapshot.binding.appId, releaseType: '1' },
      undefined,
      transport,
    )
    if (
      !matchesHuaweiVersion(parsed.appInfo, plan) ||
      !isRecord(parsed.appInfo) ||
      // 官方没有保证文件解析后一定转为草稿；只接受仍可编辑的在架／草稿态，不能要求固定为 7。
      !['0', '7'].includes(storeScalar(parsed.appInfo.releaseState)) ||
      !Array.isArray(parsed.languages) ||
      parsed.languages.filter(
        (language) =>
          isRecord(language) &&
          language.lang === snapshot.huawei?.defaultLang &&
          language.newFeatures === snapshot.releaseNotes,
      ).length !== 1
    )
      throw new StoreRequestError('huawei_package_unverified')
    await verifyStoreWindow(plan, vaultPath)
    const releaseTime =
      snapshot.releasePolicy.mode === 'scheduled'
        ? releaseUtcTime(snapshot.releasePolicy.notBefore)
        : undefined
    await harmonyRequest(
      session,
      'androidSubmit',
      {
        appId: snapshot.binding.appId,
        releaseType: '1',
        ...(releaseTime ? { releaseTime } : {}),
      },
      undefined,
      transport,
    )

    // 5. 成功回执还须看到同一构建进入官方审核状态；其他异步状态保持待核对。
    const submitted = await harmonyRequest(
      session,
      'androidInfo',
      { appId: snapshot.binding.appId, releaseType: '1' },
      undefined,
      transport,
    )
    const app = submitted.appInfo
    if (
      !matchesHuaweiVersion(app, plan) ||
      !isRecord(app) ||
      !['4', '5'].includes(storeScalar(app.releaseState))
    )
      throw new StoreRequestError('store_receipt_missing')
    return 'huawei_review_submitted'
  } catch (error) {
    stage =
      error instanceof StoreRequestError ? error.diagnostic : remote ? 'remote_unknown' : stage
    ports.report?.(stage)
    return remote ? 'needs_reconciliation' : 'verification_failed'
  }
}

/** 在写入与送审之间校验解析版本，未公开的包名字段仅在实际返回时校验。 */
function matchesHuaweiVersion(value: unknown, plan: StoreReleaseContext): boolean {
  return (
    isRecord(value) &&
    (!Object.hasOwn(value, 'packageName') ||
      value.packageName === plan.snapshot.application.identifier) &&
    (!Object.hasOwn(value, 'releaseType') || storeScalar(value.releaseType) === '1') &&
    value.defaultLang === plan.snapshot.huawei?.defaultLang &&
    storeScalar(value.versionCode) === plan.snapshot.artifact.identity?.buildNumber &&
    value.versionNumber === plan.snapshot.artifact.identity?.versionName
  )
}
