/** @description 凭据目录及只读预检的私有父子协议，路径只由本机启动配置确定。 */
import { isAbsolute } from 'node:path'
import {
  isProfileReference,
  isProfileRevision,
  isRecord,
  preflightMessages,
  type PreflightRecord,
} from '@release-harbor/contracts'
import { isInspectionTask, type InspectionTask } from './protocol.ts'

/** 目录读取不触发凭据解析，预检携带完整产物与绑定快照。 */
export type PreflightTask =
  | {
      schemaVersion: 1
      action: 'catalog'
      nonce: string
      vaultPath: string
    }
  | {
      schemaVersion: 1
      action: 'preflight'
      nonce: string
      vaultPath: string
      channel: 'huawei' | 'app_store'
      appId: string
      reference: string
      profileRevision: string
      inspection: InspectionTask
    }

/** 固定投影，不允许原始供应商错误或材料出进程。 */
export type PreflightOutcome = Pick<
  PreflightRecord,
  'code' | 'artifact' | 'authentication' | 'target'
>

/** 只有鉴权与目标同时通过才允许成功码，未知字段一律拒绝。 */
export function isPreflightOutcome(value: unknown): value is PreflightOutcome {
  return (
    isRecord(value) &&
    Object.keys(value).length === 4 &&
    typeof value.code === 'string' &&
    value.code !== 'running' &&
    Object.hasOwn(preflightMessages, value.code) &&
    ['artifact', 'authentication', 'target'].every(
      (k) => typeof value[k] === 'string' && ['passed', 'unverified'].includes(value[k]),
    ) &&
    (value.code !== 'verified' ||
      ['artifact', 'authentication', 'target'].every((k) => value[k] === 'passed'))
  )
}

/** worker 拒绝混入发布动作及任意文件路径；inspect 自身继续核对受控目录与字节。 */
export function isPreflightTask(value: unknown): value is PreflightTask {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.nonce !== 'string' ||
    !/^[a-f0-9]{32}$/.test(value.nonce) ||
    typeof value.vaultPath !== 'string' ||
    !isAbsolute(value.vaultPath) ||
    /[\x00-\x1f]/.test(value.vaultPath)
  )
    return false
  if (value.action === 'catalog') return Object.keys(value).length === 4
  return (
    value.action === 'preflight' &&
    Object.keys(value).length === 9 &&
    (value.channel === 'huawei' || value.channel === 'app_store') &&
    typeof value.appId === 'string' &&
    /^\d{1,32}$/.test(value.appId) &&
    isProfileReference(value.reference) &&
    isProfileRevision(value.profileRevision) &&
    isInspectionTask(value.inspection) &&
    value.inspection.nonce === value.nonce &&
    value.channel === (value.inspection.target.platform === 'ios' ? 'app_store' : 'huawei')
  )
}
