/** @description 一次性执行尝试的安全回执；仅固定状态、摘要和时间，不包含供应商正文、路径或秘密。 */
import { isRecord } from './applications.ts'
import { isProfileRevision } from './preflights.ts'
import { hasExactKeys, isPlanId } from './release-plans.ts'

/** 已获远端许可后的失败一律待核对，不能推断商店未写入。 */
export const attemptMessages = {
  preparing: '正在独立复核计划、安装包与商店目标',
  running: '正在保存华为草稿，请勿重复操作',
  draft_saved: '华为草稿已保存；尚未送审或上线',
  verification_failed: '执行前复核未通过，未获远端写入许可，请重新预检',
  interrupted: '执行前中断，未获远端写入许可；本次授权已消费',
  needs_reconciliation: '远端结果待核对，请到商店后台确认草稿和版本；系统不会自动重试',
} as const
/** 固定终态不携带原始错误信息。 */
export type AttemptResult =
  | 'draft_saved'
  | 'verification_failed'
  | 'interrupted'
  | 'needs_reconciliation'
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
    ]) ||
    !isPlanId(value.id) ||
    !isPlanId(value.planId) ||
    !isPlanId(value.authorizationId) ||
    !isProfileRevision(value.planDigest) ||
    !time(value.createdAt)
  )
    return false
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
      value.code === 'draft_saved' &&
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
