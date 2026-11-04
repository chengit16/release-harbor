/** @description OPPO 普通应用单 APK 更新；白名单资料复用、单次上传及版本提交，异步处理不冒充审核完成。 */
import { createHash } from 'node:crypto'
import { createReadStream, openAsBlob } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import type { CredentialProfileStore } from '@huoye/app-ship'
import {
  isReleasePolicyCurrent,
  type ReleasePlan,
  type AttemptResult,
  type ExecutionDiagnostic,
} from '@release-harbor/contracts'
import { planFingerprint } from '@release-harbor/domain'
import { profileRevision, type MerchantCheck } from './credentials.ts'
import { oppoMaterials } from './oppo-material.ts'
import {
  type OppoSession,
  OppoRequestError,
  isOppoUploadUrl,
  oppoJson,
  oppoRequest,
  oppoSession,
} from './oppo-client.ts'

/** 只允许 token／普通包详情查询，获取上传配置和任何写入仅在独立执行中调用。 */
export async function checkOppoUpdate(
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
      platform: 'oppo',
      purpose: 'verify',
    })
    const session = await oppoSession(material.fields, transport)
    authentication = 'passed'
    const { summary } = oppoMaterials(
      await oppoRequest('info', session, { pkg_name: identifier }, transport),
      identifier,
    )
    return { code: 'verified', authentication, target: 'passed', oppo: summary }
  } catch (error) {
    if (!(error instanceof OppoRequestError)) return result('credentials_unavailable')
    return result(
      error.diagnostic === 'merchant_target'
        ? 'application_mismatch'
        : error.diagnostic === 'oppo_target_not_ready'
          ? 'application_not_ready'
          : error.diagnostic === 'oppo_materials_missing'
            ? 'oppo_materials_unavailable'
            : error.diagnostic === 'oppo_request_rejected' ||
                error.diagnostic === 'merchant_authentication'
              ? 'rejected'
              : error.diagnostic === 'upload_invalid_response'
                ? 'invalid_response'
                : 'network_unavailable',
    )
  }
}
/** 仅可信宿主可注入端口，测试不读取真实账号或请求平台；页面和任务不能选择替身。 */
export interface OppoExecutionPorts {
  transport?: typeof fetch
  report?: (diagnostic: ExecutionDiagnostic) => void
  wait?: (milliseconds: number) => Promise<unknown>
}
/** 一次许可覆盖单次上传及一次版本提交；任何许可后异常保持待核对，不重试写操作。 */
export async function submitOppoUpdate(
  plan: ReleasePlan,
  file: string,
  vaultPath: string,
  beforeRemote: () => Promise<void>,
  store: CredentialProfileStore,
  ports: OppoExecutionPorts = {},
): Promise<AttemptResult> {
  const transport = ports.transport ?? fetch,
    report = ports.report ?? (() => undefined)
  const s = plan.snapshot
  let remote = false,
    stage: ExecutionDiagnostic = 'oppo_submission_validation'
  try {
    // 1. 只复用冻结来源版本；私人审核材料不进入快照，执行中从该版本响应取得。
    if (
      s.action !== 'oppo_submit_review' ||
      s.binding.channel !== 'oppo' ||
      !s.oppo ||
      !s.releasePolicy ||
      s.binding.appId !== s.application.identifier ||
      !/^\d{1,18}$/.test(s.artifact.identity?.buildNumber ?? '')
    )
      return 'verification_failed'
    stage = 'profile_changed'
    const material = await store.resolveForLocalExecution({
      credentialProfile: s.binding.credentialReference,
      platform: 'oppo',
      purpose: 'release_execution',
    })
    stage = 'merchant_authentication'
    const session = await oppoSession(material.fields, transport)
    stage = 'merchant_unavailable'
    const current = oppoMaterials(
      await oppoRequest('info', session, { pkg_name: s.application.identifier }, transport),
      s.application.identifier,
    )
    stage = 'oppo_materials_changed'
    if (
      planFingerprint(current.summary) !== planFingerprint(s.oppo) ||
      BigInt(s.artifact.identity?.buildNumber ?? '0') <= BigInt(s.oppo.sourceVersionCode)
    )
      return 'verification_failed'
    // 2. 在取得一次性上传配置前复核实际副本，发布类型显式映射且不降级定时策略。
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
    stage = 'oppo_upload_configuration'
    const upload = await oppoRequest('upload', session, {}, transport)
    if (
      !isOppoUploadUrl(upload.upload_url) ||
      typeof upload.sign !== 'string' ||
      !upload.sign ||
      upload.sign.length > 8192
    )
      return 'verification_failed'
    stage = 'authorization_changed'
    if (
      !plan.authorization ||
      Date.now() >= Date.parse(plan.authorization.expiresAt) ||
      !isReleasePolicyCurrent(s.releasePolicy, Date.now()) ||
      (await profileRevision(vaultPath)) !== s.preflight.profileRevision
    )
      return 'verification_failed'
    const body = new FormData()
    body.set('file', await openAsBlob(file), 'payload.apk')
    body.set('type', 'apk')
    body.set('sign', upload.sign)
    await beforeRemote()
    remote = true
    stage = 'remote_unknown'
    // 3. 单次上传成功仅是文件接收；MD5、大小和 HTTPS 文件地址不匹配时停止，不能继续送审。
    const received = await oppoJson(upload.upload_url, { method: 'POST', body }, transport, 300000)
    if (
      !isOppoUploadUrl(received.url) ||
      received.md5 !== digest ||
      Number(received.file_size) !== size
    )
      throw new OppoRequestError('oppo_upload_mismatch')
    if (
      !isReleasePolicyCurrent(s.releasePolicy, Date.now()) ||
      (await profileRevision(vaultPath)) !== s.preflight.profileRevision
    )
      throw new OppoRequestError('oppo_submit_interrupted')
    const params: Record<string, string> = {
      ...s.oppo.fields,
      ...current.privateFields,
      pkg_name: s.application.identifier,
      app_name: s.oppo.appName,
      version_code: s.artifact.identity?.buildNumber ?? '',
      version_name: s.artifact.identity?.versionName ?? '',
      version_type: '2',
      update_desc: s.releaseNotes,
      apk_url: JSON.stringify([{ url: received.url, md5: digest, cpu_code: 0 }]),
      online_type: s.releasePolicy.mode === 'scheduled' ? '2' : '1',
    }
    if (s.releasePolicy.mode === 'scheduled')
      params.sche_online_time = new Date(Date.parse(s.releasePolicy.notBefore) + 8 * 3600000)
        .toISOString()
        .slice(0, 19)
        .replace('T', ' ')
    const submitted = await oppoRequest('submit', session, params, transport)
    if (submitted.success !== true) throw new OppoRequestError('upload_invalid_response')
    // 4. app/upd 是异步受理，最多观察 6 次只读任务状态；成功必须匹配本次包名与构建号。
    return await observeOppoTask(
      session,
      s.application.identifier,
      params.version_code ?? '',
      transport,
      ports,
    )
  } catch (error) {
    stage = error instanceof OppoRequestError ? error.diagnostic : stage
    report(stage)
    return remote ? 'needs_reconciliation' : 'verification_failed'
  } finally {
    // 正常拒绝路径也报告当前阶段；成功时协调器不会保存诊断为失败。
    if (!remote) report(stage)
  }
}

/** 受理后仅有界观察本次版本任务，任何非成功结论仍须核对，不重放上传或版本提交。 */
async function observeOppoTask(
  session: OppoSession,
  identifier: string,
  versionCode: string,
  transport: typeof fetch,
  ports: OppoExecutionPorts,
): Promise<AttemptResult> {
  for (let n = 0; n < 6; n++) {
    const task = await oppoRequest(
      'task',
      session,
      { pkg_name: identifier, version_code: versionCode },
      transport,
    )
    if (task.pkg_name !== identifier || String(task.version_code) !== versionCode)
      throw new OppoRequestError('oppo_task_mismatch')
    if (String(task.task_state) === '2') return 'oppo_version_processed'
    if (String(task.task_state) === '3') throw new OppoRequestError('oppo_task_failed')
    if (String(task.task_state) !== '1') throw new OppoRequestError('upload_invalid_response')
    if (n < 5) await (ports.wait ?? delay)(2000)
  }
  ports.report?.('oppo_task_pending')
  return 'needs_reconciliation'
}
