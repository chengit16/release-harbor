/** @description vivo 已上架普通应用单 APK 更新；只读来源复核、一次上传和一次同步提交，不宣称审核或上架完成。 */
import { createHash } from 'node:crypto'
import { createReadStream, openAsBlob } from 'node:fs'
import type { CredentialProfileStore } from '@huoye/app-ship'
import {
  isVivoUpdateDetails,
  isVivoVersionCode,
  sameVivoUpdateDetails,
  isReleasePolicyCurrent,
  type VivoUpdateDetails,
  type AttemptResult,
  type ExecutionDiagnostic,
} from '@release-harbor/contracts'
import { storeWindowCurrent, type StoreReleaseContext } from './store-release-context.ts'
import { profileRevision, type MerchantCheck } from './credentials.ts'
import { VivoRequestError, vivoRequest } from './vivo-client.ts'
import { releaseChinaTime } from './release-time.ts'

/** 平台仅接受文本或整数枚举，不将数组或对象隐式转换成合法字段。 */
function scalar(value: unknown): string {
  return typeof value === 'string' || (typeof value === 'number' && Number.isSafeInteger(value))
    ? String(value)
    : ''
}
/** 不推断缺失状态；游戏、草稿、待审核、未上架和缺失设备范围都不进入首批更新。 */
export function vivoSource(data: Record<string, unknown>, identifier: string): VivoUpdateDetails {
  if (data.packageName !== identifier) throw new VivoRequestError('merchant_target')
  if (
    scalar(data.appType) !== '1' ||
    scalar(data.saleStatus) !== '1' ||
    !['3', '4', '5'].includes(scalar(data.status))
  )
    throw new VivoRequestError('vivo_target_not_ready')
  const source = {
    sourceVersionCode: scalar(data.versionCode),
    compatibleDevice: scalar(data.compatibleDevice),
  }
  if (!isVivoUpdateDetails(source)) throw new VivoRequestError('vivo_source_unavailable')
  return source
}
/** 只调用 app.query.details；鉴权通过不代表上传权限通过，失败仅返回固定建议。 */
export async function checkVivoUpdate(
  reference: string,
  identifier: string,
  appId: string,
  store: CredentialProfileStore,
  transport: typeof fetch = fetch,
): Promise<MerchantCheck> {
  let authentication: MerchantCheck['authentication'] = 'unverified'
  const result = (code: MerchantCheck['code']): MerchantCheck => ({
    code,
    authentication,
    target: 'unverified',
  })
  if (appId !== identifier) return result('application_mismatch')
  try {
    const material = await store.resolveForLocalExecution({
      credentialProfile: reference,
      platform: 'vivo',
      purpose: 'verify',
    })
    const data = await vivoRequest(
      'app.query.details',
      material.fields,
      { packageName: identifier },
      transport,
    )
    authentication = 'passed'
    return {
      code: 'verified',
      authentication,
      target: 'passed',
      vivo: vivoSource(data, identifier),
    }
  } catch (error) {
    if (!(error instanceof VivoRequestError)) return result('credentials_unavailable')
    const codes: Partial<Record<ExecutionDiagnostic, MerchantCheck['code']>> = {
      vivo_authentication: 'invalid_credentials',
      vivo_rate_limited: 'query_rate_limited',
      merchant_target: 'application_mismatch',
      vivo_target_mismatch: 'application_mismatch',
      vivo_target_not_ready: 'application_not_ready',
      vivo_source_unavailable: 'vivo_source_unavailable',
      vivo_request_rejected: 'rejected',
      upload_invalid_response: 'invalid_response',
    }
    return result(codes[error.diagnostic] ?? 'network_unavailable')
  }
}
/** 测试只能通过可信装配替换网络，不允许页面、任务或环境选择模拟结果。 */
export interface VivoExecutionPorts {
  transport?: typeof fetch
  report?: (code: ExecutionDiagnostic) => void
}
/**
 * 独立执行仅复用冻结设备范围，其他可选商店资料省略；许可后任何异常保持待核对。
 * 长函数保留原因：查询、字节、许可和远端提交共享单次执行状态，按阶段维护未知结果边界。
 */
export async function submitVivoUpdate(
  plan: StoreReleaseContext,
  file: string,
  vaultPath: string,
  beforeRemote: () => Promise<void>,
  store: CredentialProfileStore,
  ports: VivoExecutionPorts = {},
): Promise<AttemptResult> {
  const s = plan.snapshot,
    transport = ports.transport ?? fetch
  let remote = false,
    stage: ExecutionDiagnostic = 'vivo_submission_validation'
  try {
    // 1. 限制为已有普通应用、递增的单包版本和显式上架策略，来源不可由浏览器构造。
    if (
      s.action !== 'vivo_submit_review' ||
      s.binding.channel !== 'vivo' ||
      !s.vivo ||
      !s.releasePolicy ||
      s.binding.appId !== s.application.identifier ||
      !isVivoVersionCode(s.artifact.identity?.buildNumber) ||
      Array.from(s.releaseNotes).length < 5 ||
      Array.from(s.releaseNotes).length > 200
    )
      return 'verification_failed'
    stage = 'profile_changed'
    const material = await store.resolveForLocalExecution({
      credentialProfile: s.binding.credentialReference,
      platform: 'vivo',
      purpose: 'release_execution',
    })
    stage = 'merchant_unavailable'
    const current = vivoSource(
      await vivoRequest(
        'app.query.details',
        material.fields,
        { packageName: s.application.identifier },
        transport,
      ),
      s.application.identifier,
    )
    stage = 'vivo_source_changed'
    if (
      !sameVivoUpdateDetails(current, s.vivo) ||
      BigInt(s.artifact.identity.buildNumber) <= BigInt(current.sourceVersionCode)
    )
      return 'verification_failed'
    // 2. 在远端许可前复核独立副本；上架时间到期时拒绝，不切换成实时上架。
    stage = 'artifact_invalid'
    const md5 = createHash('md5'),
      sha = createHash('sha256')
    let size = 0
    for await (const chunk of createReadStream(file)) {
      md5.update(chunk)
      sha.update(chunk)
      size += chunk.length
    }
    if (size !== s.artifact.sizeBytes || sha.digest('hex') !== s.artifact.sha256)
      return 'verification_failed'
    const digest = md5.digest('hex')
    stage = 'authorization_changed'
    if (
      !storeWindowCurrent(plan) ||
      !isReleasePolicyCurrent(s.releasePolicy, Date.now()) ||
      (await profileRevision(vaultPath)) !== s.preflight.profileRevision
    )
      return 'verification_failed'
    const blob = await openAsBlob(file)
    await beforeRemote()
    remote = true
    // 3. 上传只发一次；完整匹配平台解析结果后才能发送更新，文件接收不能冒充送审成功。
    const uploaded = await vivoRequest(
      'app.upload.apk.app',
      material.fields,
      { packageName: s.application.identifier, fileMd5: digest },
      transport,
      blob,
    )
    if (
      uploaded.packageName !== s.application.identifier ||
      scalar(uploaded.versionCode) !== s.artifact.identity.buildNumber ||
      uploaded.versionName !== s.artifact.identity.versionName ||
      uploaded.fileMd5 !== digest ||
      typeof uploaded.serialnumber !== 'string' ||
      !/^[A-Za-z0-9_-]{1,256}$/.test(uploaded.serialnumber)
    )
      throw new VivoRequestError('vivo_upload_mismatch')
    if (
      !isReleasePolicyCurrent(s.releasePolicy, Date.now()) ||
      (await profileRevision(vaultPath)) !== s.preflight.profileRevision
    )
      throw new VivoRequestError('vivo_submit_interrupted')
    const params: Record<string, string> = {
      packageName: s.application.identifier,
      versionCode: s.artifact.identity.buildNumber,
      apk: uploaded.serialnumber,
      fileMd5: digest,
      compatibleDevice: s.vivo.compatibleDevice,
      updateDesc: s.releaseNotes,
      onlineType: s.releasePolicy.mode === 'scheduled' ? '2' : '1',
    }
    // 中国网关的无时区时间按 Asia/Shanghai 映射；UTC 意图始终保留在不可变快照。
    if (s.releasePolicy.mode === 'scheduled')
      params.scheOnlineTime = releaseChinaTime(s.releasePolicy.notBefore)
    // 4. 同步接口明确成功才记已接收更新；不以授权消费、上传或 HTTP 200 代替业务成功。
    await vivoRequest('app.sync.update.app', material.fields, params, transport)
    return 'vivo_update_accepted'
  } catch (error) {
    stage = error instanceof VivoRequestError ? error.diagnostic : remote ? 'remote_unknown' : stage
    ports.report?.(stage)
    return remote ? 'needs_reconciliation' : 'verification_failed'
  } finally {
    if (!remote) ports.report?.(stage)
  }
}
