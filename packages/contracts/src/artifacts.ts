/** @description 产物记录与检查结果的公开合同，不含存储路径、凭据或执行器内部参数。 */
import { isRecord } from './applications.ts'
import type { ArtifactIdentity } from './index.ts'

/** 当前固定资源边界，浏览器提示与服务端执行共享同一数值。 */
export const artifactLimits = {
  maxFileBytes: 256 * 1024 * 1024,
  storageBudgetBytes: 2 * 1024 * 1024 * 1024,
  diskReserveBytes: 64 * 1024 * 1024,
  /** 接收的绝对总上限；浏览器等待略长于此值，为失败记录和响应预留时间。 */
  uploadTimeoutMs: 60 * 60 * 1000,
  /** 连续没有接收进度的上限；持续传输的大包不再被原两分钟总时限截断。 */
  uploadIdleTimeoutMs: 2 * 60 * 1000,
  inspectionTimeoutMs: 90000,
} as const

/** 固定错误投影，SDK 原始错误及路径不得返回浏览器。 */
export const artifactFailureMessages = {
  upload_incomplete: '文件接收中断或实际大小与声明不一致，请重新选择文件上传。',
  upload_too_large: '接收字节超过大小限制，已清理不完整文件。',
  upload_timeout: '文件接收超时，已停止本次接收。',
  storage_failed: '产物字节未能完整保存，请检查磁盘空间或写入权限。',
  inspection_unavailable:
    '本机缺少检查工具。APK 需 aapt/aapt2，IPA 需 unzip 和 plutil，鸿蒙 APP 需 unzip。',
  inspection_failed: '无法读取安装包身份或版本，文件可能损坏、工具异常或检查超时。',
  identity_mismatch: '安装包的平台或包身份与当前登记应用不一致。',
  digest_mismatch: '检查时文件大小或 SHA-256 已变化，产物不可用。',
  interrupted: '服务在接收或检查期间中断，本次未完成，未自动重试。',
  removed: '安装包原文件已由用户清理，身份和发布历史保留；再次使用需重新导入。',
  storage_missing: '已检查产物的文件缺失或被修改，请重新上传。',
} as const

/** 只描述本地接收与身份检查，不包含商店执行状态。 */
export type ArtifactStatus = 'receiving' | 'checking' | 'ready' | 'failed'
/** 稳定且安全的检查失败分类。 */
export type ArtifactFailureCode = keyof typeof artifactFailureMessages

/** 某次接收与检查的事实；ready 不代表签名、凭据或商店审核通过。 */
export interface ArtifactRecord {
  id: string
  /** 服务端可信归属，不接受浏览器指定。 */
  workspaceId: string
  projectId: string
  applicationId: string
  /** 安全显示名称，不参与内部文件路径构造。 */
  fileName: string
  format: 'apk' | 'ipa' | 'app'
  status: ArtifactStatus
  /** 客户端声明的预期字节数，服务端必须实测核对。 */
  expectedSizeBytes: number
  /** 接收完成后的真实字节数；接收未完成时为 0。 */
  sizeBytes: number
  /** 接收完成后计算的 SHA-256；接收未完成时为 null。 */
  sha256: string | null
  /** 来自实际字节的检查结果，失败时可保留已取得的安全身份。 */
  identity: ArtifactIdentity | null
  failureCode: ArtifactFailureCode | null
  /** ISO 8601 UTC 时间，记录最后一次状态变化。 */
  createdAt: string
  updatedAt: string
}

/** 限制 SDK 输出的安全投影，版本为不含控制字符的显示文本。 */
export function isArtifactIdentity(value: unknown): value is ArtifactIdentity {
  return (
    isRecord(value) &&
    (value.format === 'apk' || value.format === 'ipa' || value.format === 'app') &&
    typeof value.packageName === 'string' &&
    value.packageName.length <= 255 &&
    /^[A-Za-z0-9_.-]+$/.test(value.packageName) &&
    ['versionName', 'buildNumber'].every(
      (key) =>
        typeof value[key] === 'string' &&
        value[key].length > 0 &&
        value[key].length <= 255 &&
        !/[\x00-\x1f\x7f]/.test(value[key]),
    ) &&
    typeof value.sizeBytes === 'number' &&
    Number.isSafeInteger(value.sizeBytes) &&
    value.sizeBytes > 0 &&
    typeof value.sha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(value.sha256)
  )
}

/** 校验完整状态约束，缺少检查结果的记录不可被投影为 ready。 */
export function isArtifactRecord(value: unknown): value is ArtifactRecord {
  if (
    !isRecord(value) ||
    ![
      'id',
      'workspaceId',
      'projectId',
      'applicationId',
      'fileName',
      'createdAt',
      'updatedAt',
    ].every((key) => typeof value[key] === 'string' && value[key].length > 0) ||
    (value.format !== 'apk' && value.format !== 'ipa' && value.format !== 'app') ||
    !['receiving', 'checking', 'ready', 'failed'].includes(String(value.status)) ||
    typeof value.expectedSizeBytes !== 'number' ||
    !Number.isSafeInteger(value.expectedSizeBytes) ||
    value.expectedSizeBytes < 1 ||
    typeof value.sizeBytes !== 'number' ||
    !Number.isSafeInteger(value.sizeBytes) ||
    value.sizeBytes < 0 ||
    (value.sha256 !== null &&
      (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256))) ||
    (value.identity !== null && !isArtifactIdentity(value.identity))
  )
    return false
  if (value.status === 'failed') {
    if (
      typeof value.failureCode !== 'string' ||
      !Object.hasOwn(artifactFailureMessages, value.failureCode)
    )
      return false
  } else if (value.failureCode !== null) return false
  if (value.status === 'checking' || value.status === 'ready') {
    if (value.sizeBytes !== value.expectedSizeBytes || value.sha256 === null) return false
  }
  return (
    value.status !== 'ready' ||
    (isArtifactIdentity(value.identity) &&
      value.identity.sha256 === value.sha256 &&
      value.identity.sizeBytes === value.sizeBytes &&
      value.identity.format === value.format)
  )
}
