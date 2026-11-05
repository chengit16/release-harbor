/** @description 正式鸿蒙 APP 的分片上传、软件包解析、更新说明和完整送审；草稿与审核受理严格区分。 */
import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'
import { openAsBlob } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import type { CredentialProfileStore } from '@huoye/app-ship'
import {
  isRecord,
  type ReleasePlan,
  type AttemptResult,
  type ExecutionDiagnostic,
} from '@release-harbor/contracts'
import {
  harmonySession,
  harmonyRequest,
  isFinalUploadUrl,
  putFinalFile,
  type HarmonySession,
} from './tencent-harmony-client.ts'
import { harmonyTarget } from './tencent-harmony-material.ts'
import { StoreRequestError, storeScalar } from './store-client.ts'
import { verifyStoreArtifact, verifyStoreWindow } from './store-execution.ts'
import type { StoreExecutionPorts } from './meizu-updates.ts'
/** 只有可信宿主／测试可替换等待时钟，发布任务和浏览器不能跳过官方两分钟解析等待。 */
export interface HarmonyExecutionPorts extends StoreExecutionPorts {
  pause?: (ms: number) => Promise<void>
  clock?: () => number
}
function text(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= 4096 && !/[\x00-\x1f\x7f]/.test(v)
}
/** 存储头仅采用平台签发值，不复制开发者 Bearer；Host 和长度必须与实际上传相符。 */
function storageHeaders(value: unknown, url: string, length: number): Record<string, string> {
  let raw: unknown = value
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    } catch {
      throw new StoreRequestError('store_upload_mismatch')
    }
  }
  if (!isRecord(raw)) throw new StoreRequestError('store_upload_mismatch')
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) {
    const key = k.toLowerCase()
    if (
      !['authorization', 'host', 'content-type', 'content-length', 'content-md5'].includes(key) &&
      !key.startsWith('x-amz-') &&
      !key.startsWith('x-obs-')
    )
      throw new StoreRequestError('store_upload_mismatch')
    if (
      !text(v) ||
      /[\r\n]/.test(v) ||
      (key === 'host' && v !== new URL(url).host) ||
      (key === 'content-length' && v !== String(length)) ||
      (key === 'authorization' && !v.startsWith('AWS4-HMAC-SHA256 ') && !v.startsWith('OBS '))
    )
      throw new StoreRequestError('store_upload_mismatch')
    if (key !== 'host') out[key] = v
  }
  out['content-length'] = String(length)
  return out
}
/** 分片最多 100 MiB 且最多 1000 片，逐片有界读取和核对 ETag，不进行不明写入重试。 */
async function uploadPack(
  session: HarmonySession,
  plan: ReleasePlan,
  file: string,
  vaultPath: string,
  transport: typeof fetch,
): Promise<string> {
  const s = plan.snapshot,
    init = await harmonyRequest(
      session,
      'init',
      {
        appId: s.binding.appId,
        fileName: 'payload.app',
        contentType: 'application/octet-stream',
        fileType: '1',
        releaseType: '1',
      },
      undefined,
      transport,
    )
  const objectId = init.objectId,
    nspUploadId = init.nspUploadId,
    min = init.nspPartMinSize ?? 5242880,
    max = init.nspPartMaxSize ?? 104857600
  if (
    !text(objectId) ||
    !text(nspUploadId) ||
    typeof min !== 'number' ||
    !Number.isSafeInteger(min) ||
    min < 1 ||
    min > 104857600 ||
    typeof max !== 'number' ||
    !Number.isSafeInteger(max) ||
    max < min
  )
    throw new StoreRequestError('store_upload_mismatch')
  const size = Math.max(min, 5242880),
    count = Math.ceil(s.artifact.sizeBytes / size)
  if (size > max || count < 1 || count > 1000) throw new StoreRequestError('store_upload_mismatch')
  const descriptors: Record<string, { sha256: string; length: number }> = {},
    handle = await open(file, 'r')
  try {
    for (let n = 1; n <= count; n++) {
      const length = Math.min(size, s.artifact.sizeBytes - (n - 1) * size),
        buffer = Buffer.alloc(length),
        { bytesRead } = await handle.read(buffer, 0, length, (n - 1) * size)
      if (bytesRead !== length) throw new StoreRequestError('artifact_invalid')
      descriptors[`additionalProp${n}`] = {
        sha256: createHash('sha256').update(buffer).digest('hex'),
        length,
      }
    }
  } finally {
    await handle.close()
  }
  await verifyStoreWindow(plan, vaultPath)
  const query = { objectId, nspUploadId },
    parts = (await harmonyRequest(session, 'parts', query, descriptors, transport)).uploadInfoMap,
    completed: Record<string, { partObjectId: string; etag: string }> = {}
  if (!isRecord(parts) || Object.keys(parts).length !== count)
    throw new StoreRequestError('store_upload_mismatch')
  const blob = await openAsBlob(file)
  for (let n = 1; n <= count; n++) {
    const key = `additionalProp${n}`,
      p = parts[key],
      d = descriptors[key]
    if (
      !isRecord(p) ||
      !d ||
      p.method !== 'PUT' ||
      !isFinalUploadUrl(p.url, 'harmony') ||
      typeof p.partObjectId !== 'string' ||
      p.partObjectId.length > 4096
    )
      throw new StoreRequestError('store_upload_mismatch')
    await verifyStoreWindow(plan, vaultPath)
    const response = await putFinalFile(
        p.url,
        blob.slice((n - 1) * size, (n - 1) * size + d.length),
        storageHeaders(p.headers, p.url, d.length),
        transport,
      ),
      etag = response.headers.get('etag')
    await response.body?.cancel()
    if (!text(etag)) throw new StoreRequestError('store_upload_mismatch')
    completed[key] = { partObjectId: p.partObjectId, etag }
  }
  await verifyStoreWindow(plan, vaultPath)
  await harmonyRequest(session, 'compose', query, completed, transport)
  return objectId
}
/** 长流程保持单次许可上下文；解析成功、新版本匹配、说明读回及两分钟等待全部完成才送审。 */
export async function submitHarmonyUpdate(
  plan: ReleasePlan,
  file: string,
  vaultPath: string,
  beforeRemote: () => Promise<void>,
  store: CredentialProfileStore,
  ports: HarmonyExecutionPorts = {},
): Promise<AttemptResult> {
  const s = plan.snapshot,
    transport = ports.transport ?? fetch,
    pause =
      ports.pause ??
      (async (ms) => {
        await delay(ms)
      }),
    clock = ports.clock ?? (() => performance.now())
  let remote = false,
    stage: ExecutionDiagnostic = 'store_submission_validation'
  try {
    // 1. 独立平台、正式 APP 与数字版本递增；华为 Android 草稿授权不能用于本流程。
    if (
      s.action !== 'harmony_submit_review' ||
      s.binding.channel !== 'harmony' ||
      s.application.platform !== 'harmony' ||
      s.artifact.format !== 'app' ||
      !s.harmony ||
      !s.artifact.identity ||
      !s.releasePolicy ||
      s.releasePolicy.mode === 'manual' ||
      s.releaseNotes.length > 1000
    )
      throw new StoreRequestError('store_submission_validation')
    stage = 'profile_changed'
    const material = await store.resolveForLocalExecution({
      credentialProfile: s.binding.credentialReference,
      platform: 'harmony',
      purpose: 'release_execution',
    })
    stage = 'merchant_unavailable'
    const session = await harmonySession(material.fields, transport),
      current = await harmonyTarget(session, s.application.identifier, s.binding.appId, transport)
    if (current.publicDigest !== s.harmony.publicDigest)
      throw new StoreRequestError('store_source_changed')
    if (
      !/^\d{1,18}$/.test(s.artifact.identity.buildNumber) ||
      BigInt(s.artifact.identity.buildNumber) <= BigInt(current.sourceVersionCode)
    )
      throw new StoreRequestError('store_version_invalid')
    await verifyStoreArtifact(plan, file)
    await verifyStoreWindow(plan, vaultPath, true)
    // 2. 先获得持久化许可，再分配对象和上传；后续异常不能推断远端未保存。
    await beforeRemote()
    remote = true
    stage = 'remote_unknown'
    const objectId = await uploadPack(session, plan, file, vaultPath, transport)
    await verifyStoreWindow(plan, vaultPath)
    const query = { appId: s.binding.appId },
      bound = await harmonyRequest(
        session,
        'bind',
        query,
        { fileName: 'payload.app', objectId },
        transport,
      ),
      packageId = storeScalar(bound.packageId),
      started = clock()
    if (!/^\d{1,32}$/.test(packageId)) throw new StoreRequestError('store_upload_mismatch')
    let parsed = false
    for (let n = 0; n < 13; n++) {
      const states = (
        await harmonyRequest(
          session,
          'compile',
          { ...query, pkgIds: packageId },
          undefined,
          transport,
        )
      ).pkgStateList
      if (
        !Array.isArray(states) ||
        states.length !== 1 ||
        !isRecord(states[0]) ||
        storeScalar(states[0].pkgId) !== packageId
      )
        throw new StoreRequestError('store_upload_mismatch')
      const status = states[0].successStatus
      if (status === 0) {
        parsed = true
        break
      }
      if (status === 2) throw new StoreRequestError('harmony_package_failed')
      if (status !== 1) throw new StoreRequestError('store_upload_mismatch')
      if (n < 12) await pause(10000)
    }
    if (!parsed) throw new StoreRequestError('harmony_package_parsing')
    // 3. 查询本次软件包身份，不能把另一个包的解析完成误认为本次构建可送审。
    const p = (
      await harmonyRequest(session, 'parsed', { ...query, packageId }, undefined, transport)
    ).packageInfo
    if (
      !isRecord(p) ||
      storeScalar(p.packageId) !== packageId ||
      p.fileName !== 'payload.app' ||
      storeScalar(p.versionCode) !== s.artifact.identity.buildNumber ||
      p.versionName !== s.artifact.identity.versionName
    )
      throw new StoreRequestError('store_upload_mismatch')
    await verifyStoreWindow(plan, vaultPath)
    await harmonyRequest(
      session,
      'notes',
      { ...query, releaseType: '1', releasePhase: '0' },
      { lang: s.harmony.defaultLang, newFeatures: s.releaseNotes },
      transport,
    )
    const readback = await harmonyRequest(
      session,
      'info',
      { ...query, releaseType: '1' },
      undefined,
      transport,
    )
    if (
      !Array.isArray(readback.languages) ||
      !readback.languages.some(
        (l) => isRecord(l) && l.lang === s.harmony?.defaultLang && l.newFeatures === s.releaseNotes,
      )
    )
      throw new StoreRequestError('store_upload_mismatch')
    // 4. 官方要求上传后至少两分钟再送审；使用单调时钟，系统时钟回拨不会跳过等待。
    await pause(Math.max(0, 120000 - (clock() - started)))
    await verifyStoreWindow(plan, vaultPath)
    await harmonyRequest(
      session,
      'submit',
      query,
      {
        releaseType: 1,
        releasePhase: 0,
        releaseTime:
          s.releasePolicy.mode === 'scheduled'
            ? s.releasePolicy.notBefore.slice(0, 19) + '+0000'
            : '2000-01-01T00:00:00+0000',
      },
      transport,
    )
    return 'harmony_review_submitted'
  } catch (e) {
    stage = e instanceof StoreRequestError ? e.diagnostic : remote ? 'remote_unknown' : stage
    ports.report?.(stage)
    return remote ? 'needs_reconciliation' : 'verification_failed'
  }
}
