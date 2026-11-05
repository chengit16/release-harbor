/** @description 一次性执行尝试的安全回执；仅固定状态、摘要和时间，不包含供应商正文、路径或秘密。 */
import { isRecord } from './applications.ts'
import { isProfileRevision } from './preflights.ts'
import { hasExactKeys, isPlanId } from './release-plans.ts'

/** 已获远端许可后的失败一律待核对，不能推断商店未写入。 */
export const attemptMessages = {
  preparing: '正在独立复核计划、安装包与商店目标',
  running: '正在执行已确认的商店操作，请勿重复操作',
  build_uploaded: 'Apple 工具报告上传已接收；暂未匹配到构建处理结果，请在 App Store Connect 核对',
  build_available: 'Apple 对应版本与构建已处理完成；尚未提交审核或上架',
  build_processing: 'Apple 对应版本与构建正在处理；尚未提交审核或上架',
  draft_saved: '华为草稿已保存；尚未送审或上线',
  oppo_version_processed: 'OPPO 版本处理成功；审核和上架状态仍以商店后台为准',
  meizu_review_submitted: '魅族新版本已进入审核；不代表审核通过或已上架',
  tencent_review_submitted: '应用宝已受理审核提交；不代表审核通过或已上架',
  harmony_review_submitted: '华为鸿蒙已受理审核提交；不代表审核通过或已上架',
  honor_review_submitted: '荣耀已受理审核提交；不代表审核通过或已上架',
  vivo_update_accepted: 'vivo 已接收更新提交；审核和上架状态仍以商店后台为准',
  review_submitted: '小米已受理审核提交；不代表审核通过或已上架',
  verification_failed: '执行前复核未通过，未获远端写入许可，请重新预检',
  interrupted: '执行前中断，未获远端写入许可；本次授权已消费',
  needs_reconciliation: '远端结果待核对，请到商店后台确认版本与审核／草稿记录；系统不会自动重试',
} as const
/** 固定终态不携带原始错误信息。 */
export type AttemptResult =
  | 'build_uploaded'
  | 'build_available'
  | 'build_processing'
  | 'draft_saved'
  | 'review_submitted'
  | 'oppo_version_processed'
  | 'vivo_update_accepted'
  | 'meizu_review_submitted'
  | 'tencent_review_submitted'
  | 'harmony_review_submitted'
  | 'honor_review_submitted'
  | 'verification_failed'
  | 'interrupted'
  | 'needs_reconciliation'
/** 固定原因与处理建议，绝不接收供应商原文。 */
export const executionDiagnostics = {
  apple_tool_unavailable: 'Apple 上传工具不可用，请安装并选择支持 API Key 上传的 Xcode',
  apple_processing_failed:
    'Apple 对应构建处理失败，请在 App Store Connect 查看处理错误；系统不会自动重传',
  plan_invalid: '计划内容或确认期限无效，请重新预检并冻结新计划',
  profile_changed: '本机账号配置版本已变化或不可读取，请到商店账号核对后重新预检',
  artifact_invalid: '安装包原件或执行副本复核失败，请重新检查安装包与本机检查工具',
  merchant_authentication: '商店只读鉴权未通过，请核对商店账号后重新预检',
  merchant_target: '商店应用目标未匹配，请核对商店 App ID 与应用身份',
  merchant_unavailable: '商店只读查询未能完成，请检查网络并重新预检',
  merchant_rate_limited: '小米只读查询触发频率限制，本次尚未上传；请稍后重新准备，不能重用旧授权',
  xiaomi_test_materials: '本机小米审核测试材料缺失或格式不正确，请在商店账号重新录入后准备',
  sdk_preparation: '上传前的凭据解析或 SDK 检查失败，请核对账号与安装包后重新预检',
  xiaomi_submission_validation:
    '小米提交前复核未通过，请核对后台名称、更新许可、审核测试材料、图标及安装包后重新准备',
  authorization_changed: '开始上传前计划依赖或许可已失效，请重新预检并冻结',
  runner_interrupted: '本机执行进程中断或超时，请根据写入许可记录判断是否需要商店核对',
  upload_timeout: '上传请求或等待回执超时，无法确定商店是否已接收；请核对后台，勿直接重试',
  upload_network_error: '上传连接中断或网络请求异常，无法确定商店是否已接收；请核对后台',
  upload_aborted: '上传请求被中止，不能据此判断商店是否已接收；请核对后台',
  upload_http_error: '上传接口返回非成功 HTTP 状态，未取得受理回执；请核对后台',
  upload_invalid_response: '上传接口回执为空、格式异常或超出读取限制，无法确认是否受理；请核对后台',
  upload_rejected: '小米上传接口返回非成功业务结果，未取得受理回执；请核对后台，系统不会自动重试',
  oppo_submission_validation: 'OPPO 提交前核对未通过，请检查当前账号、包名和单 APK 更新范围',
  oppo_target_not_ready: 'OPPO 目标不是可更新的已上架普通应用，或存在冻结、资料审核及非全量状态',
  oppo_materials_missing: 'OPPO 现有必需资料、测试说明或联系人不完整，请在商店后台完善后重新准备',
  oppo_materials_changed: 'OPPO 来源版本或公开资料已变化，或构建号未递增，请重新准备',
  oppo_upload_configuration: 'OPPO 上传配置缺失或地址不在 HTTPS 平台范围内，本次未上传',
  oppo_upload_mismatch: 'OPPO 文件回执的地址、MD5 或大小不匹配，未继续提交版本；请核对后台',
  oppo_submit_interrupted: 'OPPO 文件上传后计划时间或账号发生变化，未继续提交版本；请核对后台',
  oppo_request_rejected: 'OPPO 接口返回非成功业务结果，请按写入许可记录核对后台',
  oppo_task_pending: 'OPPO 已受理版本任务，仍在处理中；请稍后核对后台，不要重复提交',
  oppo_task_failed: 'OPPO 版本任务返回处理失败，请到后台查看具体原因并核对上传记录',
  oppo_task_mismatch: 'OPPO 任务回执与本次包名或构建号不一致，无法确认提交结果；请核对后台',
  vivo_submission_validation:
    'vivo 提交前核对未通过，请检查普通应用、单 APK、上架类型及 5–200 字更新说明',
  vivo_authentication: 'vivo 签名或 API 权限未通过，请核对正式传包密钥、账号状态及 API 权限',
  vivo_rate_limited: 'vivo 请求触发频次或日限额，请稍后核对后台，不要重复提交',
  vivo_target_not_ready: 'vivo 目标须为可更新的已上架普通应用；请检查审核、待上架、合同及应用类型',
  vivo_target_mismatch: 'vivo 返回目标不存在或包名不匹配，请核对账号下应用和后台记录',
  vivo_source_unavailable: 'vivo 来源构建号或兼容设备缺失，无法安全复用，请在后台完善后重新准备',
  vivo_source_changed: 'vivo 来源构建号或兼容设备已变化，或安装包版本未递增，请重新准备',
  vivo_version_invalid: 'vivo 返回构建号不合法或未递增，请核对后台版本和安装包',
  vivo_release_time_invalid: 'vivo 拒绝了上架类型或时间，请核对未来上架时间和后台时区',
  vivo_notes_invalid: 'vivo 新版说明不符合 5–200 字要求，请修改后重新准备',
  vivo_upload_mismatch: 'vivo 上传回执缺失或包名、版本、MD5 不匹配，未继续更新；请核对后台',
  vivo_submit_interrupted: 'vivo 上传后账号或定时时间变化，未继续更新；请核对后台',
  vivo_request_rejected: 'vivo 返回非成功业务结果，未取得成功回执；请核对后台，系统不会自动重试',
  harmony_package_parsing: '鸿蒙软件包仍在解析，未继续送审；请到后台核对，勿重复上传',
  harmony_package_failed: '鸿蒙软件包解析失败，未继续送审；请到后台查看包校验结果',
  store_submission_validation: '当前商店提交前检查未通过，请核对普通应用、APK／APP、来源和更新说明',
  store_unsupported_release_policy:
    '魅族公开 API 暂不支持指定时间上架，本次未上传；请选择立即或在商店后台处理',
  store_authentication: '商店客户端鉴权、签名或 API 权限未通过，请核对对应平台账号',
  store_target_mismatch: '商店返回的 App ID、包名或版本与本次目标不一致，请核对后台',
  store_target_not_ready: '商店目标尚非可更新的已上架普通应用，或已有在审／待发布／编辑中的版本',
  meizu_not_on_shelf: '魅族来源版本未确认为已上架状态，本次未继续更新；请核对后台版本状态',
  meizu_pending_changes:
    '魅族已有同版本 APK 替换或资料修改待审核，本次未继续更新；请先在后台处理该修改',
  meizu_recommendation_missing:
    '魅族现有版本缺少必填“推荐语”，本次未继续更新；请在后台补齐资料后重新准备',
  store_source_invalid: '商店现有资料不完整或无法安全复用，请到后台完善后重新准备',
  store_source_changed: '商店来源版本或公开资料已经变化，请重新准备本次发布',
  store_version_invalid: '商店安装包版本、架构或递增条件不符合要求，请核对 APK／APP 与后台版本',
  store_release_time_invalid: '商店拒绝了上架类型或时间，请核对未来时间与发布范围',
  store_rate_limited: '商店接口调用过于频繁，请稍后先核对后台，系统不会重试提交',
  store_upload_mismatch: '上传或绑定的文件回执与本次版本、摘要或目标不符，未继续送审；请核对后台',
  store_submit_interrupted: '上传后账号配置或上架时间变化，未继续送审；请核对后台',
  store_receipt_missing: '平台未返回可匹配本次版本的明确送审回执，请核对新版本与审核记录',
  store_request_rejected:
    '商店接口返回非成功业务结果，未取得明确回执；请核对后台，系统不会自动重试',
  remote_unknown: '已获写入许可，但缺少确定的成功回执；请核对商店版本、审核记录与处理中任务',
} as const
/** 仅允许安全原因码跨执行进程传递。 */
export type ExecutionDiagnostic = keyof typeof executionDiagnostics
/** 许可后的原因仅表达本机观察，不能由“超时”等诊断推出商店未写入。 */
export function isRemoteExecutionDiagnostic(value: ExecutionDiagnostic): boolean {
  return [
    'apple_processing_failed',
    'harmony_package_parsing',
    'harmony_package_failed',
    'store_authentication',
    'store_target_mismatch',
    'store_target_not_ready',
    'store_source_invalid',
    'store_version_invalid',
    'store_release_time_invalid',
    'store_rate_limited',
    'store_upload_mismatch',
    'store_submit_interrupted',
    'store_receipt_missing',
    'store_request_rejected',
    'vivo_target_mismatch',
    'vivo_authentication',
    'vivo_rate_limited',
    'vivo_version_invalid',
    'vivo_release_time_invalid',
    'vivo_notes_invalid',
    'vivo_target_not_ready',
    'vivo_upload_mismatch',
    'vivo_submit_interrupted',
    'vivo_request_rejected',
    'oppo_upload_mismatch',
    'oppo_submit_interrupted',
    'oppo_request_rejected',
    'oppo_task_pending',
    'oppo_task_failed',
    'oppo_task_mismatch',
    'upload_timeout',
    'upload_network_error',
    'upload_aborted',
    'upload_http_error',
    'upload_invalid_response',
    'upload_rejected',
    'runner_interrupted',
    'remote_unknown',
  ].includes(value)
}
/** 人工声明不代表自动验证商店；相同结论只能记录一次。 */
export interface AttemptReconciliation {
  decision:
    | 'draft_present'
    | 'no_draft'
    | 'submission_present'
    | 'not_submitted'
    | 'build_present'
    | 'no_build'
  source: 'local_user'
  checkedAt: string
}
/** 页面核对既有版本并明确同意，不能替换计划目标或材料。 */
export interface ReconcileAttemptInput {
  expectedDigest: string
  versionName: string
  buildNumber: string
  decision: AttemptReconciliation['decision']
  acknowledged: true
}
/** 白名单拒绝原始错误及未知诊断。 */
export function isExecutionDiagnostic(value: unknown): value is ExecutionDiagnostic {
  return typeof value === 'string' && Object.hasOwn(executionDiagnostics, value)
}
/** 一份计划最多一次尝试；授权 ID 只供审计，不能用于发起执行。 */
export interface ReleaseAttempt {
  id: string
  planId: string
  authorizationId: string
  planDigest: string
  status: 'preparing' | 'running' | 'succeeded' | 'failed' | 'interrupted' | 'needs_reconciliation'
  code: keyof typeof attemptMessages
  createdAt: string
  /** 持久化此时间后才可授予写入许可；标记存在不证明商店已收到。 */
  remoteStartedAt: string | null
  finishedAt: string | null
  /** 旧回执无诊断时保持缺失，不推断历史原因。 */
  diagnostic?: ExecutionDiagnostic
  /** 仅原始待核对终态可附加一次结论，不能改写原始执行结果。 */
  reconciliation?: AttemptReconciliation
}
function time(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  )
}
/** 严格传输及磁盘恢复守卫，校验状态与许可时间一致。 */
export function isReleaseAttempt(value: unknown): value is ReleaseAttempt {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'id',
      'planId',
      'authorizationId',
      'planDigest',
      'status',
      'code',
      'createdAt',
      'remoteStartedAt',
      'finishedAt',
      ...(Object.hasOwn(value, 'diagnostic') ? ['diagnostic'] : []),
      ...(Object.hasOwn(value, 'reconciliation') ? ['reconciliation'] : []),
    ]) ||
    !isPlanId(value.id) ||
    !isPlanId(value.planId) ||
    !isPlanId(value.authorizationId) ||
    !isProfileRevision(value.planDigest) ||
    !time(value.createdAt)
  )
    return false
  if (
    Object.hasOwn(value, 'diagnostic') &&
    (!isExecutionDiagnostic(value.diagnostic) ||
      value.finishedAt === null ||
      value.status === 'succeeded')
  )
    return false
  if (Object.hasOwn(value, 'reconciliation')) {
    const r = value.reconciliation
    if (
      !isRecord(r) ||
      !hasExactKeys(r, ['decision', 'source', 'checkedAt']) ||
      typeof r.decision !== 'string' ||
      ![
        'draft_present',
        'no_draft',
        'submission_present',
        'not_submitted',
        'build_present',
        'no_build',
      ].includes(r.decision) ||
      r.source !== 'local_user' ||
      !time(r.checkedAt) ||
      value.status !== 'needs_reconciliation' ||
      !time(value.finishedAt) ||
      Date.parse(r.checkedAt) < Date.parse(value.finishedAt)
    )
      return false
  }
  const remote = value.remoteStartedAt
  const end = value.finishedAt
  if (remote !== null && (!time(remote) || Date.parse(remote) < Date.parse(value.createdAt)))
    return false
  if (end !== null && (!time(end) || Date.parse(end) < Date.parse(remote ?? value.createdAt)))
    return false
  return (
    (value.status === 'preparing' &&
      value.code === 'preparing' &&
      remote === null &&
      end === null) ||
    (value.status === 'running' && value.code === 'running' && remote !== null && end === null) ||
    (value.status === 'succeeded' &&
      (value.code === 'build_uploaded' ||
        value.code === 'build_available' ||
        value.code === 'build_processing' ||
        value.code === 'draft_saved' ||
        value.code === 'review_submitted' ||
        value.code === 'oppo_version_processed' ||
        value.code === 'vivo_update_accepted' ||
        value.code === 'meizu_review_submitted' ||
        value.code === 'honor_review_submitted' ||
        value.code === 'tencent_review_submitted' ||
        value.code === 'harmony_review_submitted') &&
      remote !== null &&
      end !== null) ||
    (value.status === 'failed' &&
      value.code === 'verification_failed' &&
      remote === null &&
      end !== null) ||
    (value.status === 'interrupted' &&
      value.code === 'interrupted' &&
      remote === null &&
      end !== null) ||
    (value.status === 'needs_reconciliation' &&
      value.code === 'needs_reconciliation' &&
      remote !== null &&
      end !== null)
  )
}
