/** @description 本机父子进程私有检查协议，包含内部路径，禁止从 contracts 导出或通过 HTTP 接收。 */
import { isAbsolute } from 'node:path'
import {
  artifactLimits,
  isRecord,
  type ArtifactIdentity,
  type ArtifactFailureCode,
  type ApplicationPlatform,
} from '@release-harbor/contracts'

/** 固定本地进程任务的身份、动作与字节范围，不支持发布或凭据解析。 */
export interface InspectionTask {
  schemaVersion: 1
  action: 'inspect'
  nonce: string
  artifactId: string
  storageRoot: string
  format: 'apk' | 'ipa'
  sizeBytes: number
  sha256: string
  target: {
    workspaceId: string
    projectId: string
    applicationId: string
    platform: ApplicationPlatform
    identifier: string
  }
}

/** 仅含公开检查事实或固定失败码，无 SDK 原始日志。 */
export interface InspectionOutcome {
  identity: ArtifactIdentity | null
  failureCode: ArtifactFailureCode | null
}

/** UUID 仅用作受控目录键，不允许任意路径片段。 */
export function isArtifactId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)
  )
}

/** 校验独立 worker 的动作白名单，未知任务不能触发其他 SDK 能力。 */
export function isInspectionTask(value: unknown): value is InspectionTask {
  if (!isRecord(value) || !isRecord(value.target)) return false
  const target = value.target
  return (
    Object.keys(value).length === 9 &&
    Object.keys(target).length === 5 &&
    value.schemaVersion === 1 &&
    value.action === 'inspect' &&
    typeof value.nonce === 'string' &&
    /^[a-f0-9]{32}$/.test(value.nonce) &&
    isArtifactId(value.artifactId) &&
    typeof value.storageRoot === 'string' &&
    isAbsolute(value.storageRoot) &&
    !value.storageRoot.includes('\0') &&
    (value.format === 'apk' || value.format === 'ipa') &&
    typeof value.sizeBytes === 'number' &&
    Number.isSafeInteger(value.sizeBytes) &&
    value.sizeBytes > 0 &&
    value.sizeBytes <= artifactLimits.maxFileBytes &&
    typeof value.sha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(value.sha256) &&
    ['workspaceId', 'projectId', 'applicationId', 'identifier'].every(
      (key) =>
        typeof target[key] === 'string' &&
        target[key].length > 0 &&
        target[key].length <= 255 &&
        !/[\x00-\x1f\x7f]/.test(target[key]),
    ) &&
    (target.platform === 'android' || target.platform === 'ios')
  )
}
