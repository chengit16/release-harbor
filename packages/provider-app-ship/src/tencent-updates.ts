/** @description 应用宝已有普通软件单 APK 更新：沿用未改动资料，COS 上传后一次提交审核，不复制旧包流水。 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { createReadStream, openAsBlob } from 'node:fs'
import type { CredentialProfileStore } from '@huoye/app-ship'
import type { AttemptResult, ExecutionDiagnostic, ReleasePlan } from '@release-harbor/contracts'
import { tencentTarget } from './tencent-harmony-material.ts'
import { tencentRequest, isFinalUploadUrl, putFinalFile } from './tencent-harmony-client.ts'
import { StoreRequestError } from './store-client.ts'
import { verifyStoreArtifact, verifyStoreWindow } from './store-execution.ts'
import type { StoreExecutionPorts } from './meizu-updates.ts'

/** ABI 只从实际 ZIP 条目推断；纯 64 位使用 apk64，其余通用单包使用 apk32，不伪造双包。 */
async function packageSlot(file: string): Promise<'apk32' | 'apk64'> {
  const { stdout } = await promisify(execFile)('/usr/bin/unzip', ['-Z1', file], {
    encoding: 'utf8',
    timeout: 15000,
    maxBuffer: 4 * 1024 * 1024,
  })
  const abis = new Set(
    stdout.split('\n').flatMap((line) => /^lib\/([^/]+)\/[^/]+\.so$/.exec(line)?.[1] ?? []),
  )
  if ([...abis].some((a) => !['armeabi', 'armeabi-v7a', 'arm64-v8a', 'x86', 'x86_64'].includes(a)))
    throw new StoreRequestError('store_version_invalid')
  return abis.size > 0 && [...abis].every((a) => a === 'arm64-v8a' || a === 'x86_64')
    ? 'apk64'
    : 'apk32'
}
/** 许可覆盖一次文件分配、一次 PUT 和一次送审；任何许可后的不明确结果都保留待核对。 */
export async function submitTencentUpdate(
  plan: ReleasePlan,
  file: string,
  vaultPath: string,
  beforeRemote: () => Promise<void>,
  store: CredentialProfileStore,
  ports: StoreExecutionPorts = {},
): Promise<AttemptResult> {
  const s = plan.snapshot,
    transport = ports.transport ?? fetch
  let remote = false,
    stage: ExecutionDiagnostic = 'store_submission_validation'
  try {
    // 1. 当前目标与冻结来源比对，未改动字段省略以保留后台资料与私有测试材料。
    if (
      s.action !== 'tencent_submit_review' ||
      s.binding.channel !== 'tencent' ||
      !s.tencent ||
      !s.artifact.identity ||
      !s.releasePolicy ||
      s.releasePolicy.mode === 'manual' ||
      /\p{Extended_Pictographic}/u.test(s.releaseNotes)
    )
      throw new StoreRequestError('store_submission_validation')
    stage = 'profile_changed'
    const material = await store.resolveForLocalExecution({
      credentialProfile: s.binding.credentialReference,
      platform: 'tencent',
      purpose: 'release_execution',
    })
    stage = 'merchant_unavailable'
    const current = await tencentTarget(
      material.fields,
      s.application.identifier,
      s.binding.appId,
      transport,
    )
    if (current.publicDigest !== s.tencent.publicDigest)
      throw new StoreRequestError('store_source_changed')
    if (
      !/^\d{1,18}$/.test(s.artifact.identity.buildNumber) ||
      BigInt(s.artifact.identity.buildNumber) <= BigInt(current.sourceVersionCode)
    )
      throw new StoreRequestError('store_version_invalid')
    const slot = await packageSlot(file),
      md5 = createHash('md5')
    for await (const c of createReadStream(file)) md5.update(c)
    const fileMd5 = md5.digest('hex'),
      blob = await openAsBlob(file),
      target = { pkg_name: s.application.identifier, app_id: s.binding.appId }
    await verifyStoreArtifact(plan, file)
    await verifyStoreWindow(plan, vaultPath, true)
    // 2. 上传地址分配也会创建远端记录，必须先持久化一次性许可。
    await beforeRemote()
    remote = true
    stage = 'remote_unknown'
    const upload = await tencentRequest(
      material.fields,
      'get_file_upload_info',
      { ...target, file_type: 'apk', file_name: 'payload.apk' },
      transport,
    )
    if (
      !isFinalUploadUrl(upload.pre_sign_url, 'tencent') ||
      typeof upload.serial_number !== 'string' ||
      !upload.serial_number ||
      upload.serial_number.length > 256 ||
      /[\x00-\x20\x7f]/.test(upload.serial_number)
    )
      throw new StoreRequestError('store_upload_mismatch')
    await verifyStoreWindow(plan, vaultPath)
    const response = await putFinalFile(
      upload.pre_sign_url,
      blob,
      {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(blob.size),
      },
      transport,
    )
    await response.body?.cancel()
    // 3. 显式设置两种 APK 标记及本次上架策略，绝不继承上一次定时或已上传流水。
    await verifyStoreWindow(plan, vaultPath)
    await tencentRequest(
      material.fields,
      'update_app',
      {
        ...target,
        feature: s.releaseNotes,
        apk32_flag: slot === 'apk32' ? '1' : '2',
        apk64_flag: slot === 'apk64' ? '1' : '2',
        [`${slot}_file_serial_number`]: upload.serial_number,
        [`${slot}_file_md5`]: fileMd5,
        deploy_type: s.releasePolicy.mode === 'scheduled' ? '2' : '1',
        ...(s.releasePolicy.mode === 'scheduled'
          ? { deploy_time: String(Math.floor(Date.parse(s.releasePolicy.notBefore) / 1000)) }
          : {}),
      },
      transport,
    )
    return 'tencent_review_submitted'
  } catch (e) {
    stage = e instanceof StoreRequestError ? e.diagnostic : remote ? 'remote_unknown' : stage
    ports.report?.(stage)
    return remote ? 'needs_reconciliation' : 'verification_failed'
  }
}
