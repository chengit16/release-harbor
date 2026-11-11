/** @description 本机团队审计的安全合同；只传身份、授权范围与业务关联，不含口令、秘密或本机路径。 */
import { hasExactKeys, isPlanId } from './release-plans.ts'
import { isBatchTime } from './release-batches.ts'
import { isRecord } from './applications.ts'
import { isLocalTeamMember, type LocalTeamMember } from './local-team.ts'

/** 动作名称固定，确认、执行许可与商店结果保持不同事实。 */
export const teamAuditActions = {
  member_create: '创建成员',
  member_enable: '启用成员',
  member_disable: '停用成员',
  member_reset: '重置密码',
  member_permissions: '变更权限',
  release_prepare: '准备发布',
  release_confirm: '确认发布',
  release_execute: '建立执行尝试',
  release_permit: '发放首次写许可',
  release_reconcile: '人工核对',
} as const
/** 安全业务关联；referenceId 指向授权、尝试、批次版本或运行，不能作为执行许可。 */
export interface TeamAuditTarget {
  kind: 'plan' | 'batch' | 'apple'
  projectId: string
  applicationId: string
  recordId: string
  referenceId: string
}
/** 安装级事件不随业务恢复切代；matched 仅表示匹配本机事实，不表示商店成功。 */
export interface TeamAuditEvent {
  id: string
  at: string
  actor: { id: string; username: string }
  action: keyof typeof teamAuditActions
  member: { before: LocalTeamMember | null; after: LocalTeamMember } | null
  target: TeamAuditTarget | null
  /** 管理事件与账号原子提交；发布事件需要当前业务证据匹配。 */
  state: 'atomic' | 'matched' | 'unmatched'
  /** 仅从关联的尝试或 Apple 记录读取当前回执；不是审计事件的新结论。 */
  outcome: { id: string; status: string; code: string; finishedAt: string | null } | null
}
/** 管理员分页过滤；memberId 同时匹配操作者与被管理成员，时间均为 UTC 闭区间。 */
export interface TeamAuditFilter {
  memberId?: string
  applicationId?: string
  action?: keyof typeof teamAuditActions
  from?: string
  to?: string
  page?: number
}
/** 每页最多五十项，total 为过滤后的完整数量。 */
export interface TeamAuditPage {
  items: TeamAuditEvent[]
  total: number
  page: number
}
/** 拒绝扩展字段，避免存储或公开边界夹带材料。 */
export function isTeamAuditTarget(v: unknown): v is TeamAuditTarget {
  return (
    isRecord(v) &&
    hasExactKeys(v, ['kind', 'projectId', 'applicationId', 'recordId', 'referenceId']) &&
    ['plan', 'batch', 'apple'].includes(String(v.kind)) &&
    [v.projectId, v.applicationId, v.recordId, v.referenceId].every(isPlanId)
  )
}
/** 前后授权只接受公开成员字段，密码重置事件不保存任何密码派生物。 */
function safeMember(v: unknown): v is LocalTeamMember {
  return (
    isRecord(v) &&
    isLocalTeamMember(v) &&
    hasExactKeys(v, [
      'id',
      'username',
      'role',
      'enabled',
      ...(v.permissions ? ['permissions'] : []),
    ])
  )
}
/** 磁盘与浏览器共用严格投影守卫；事件形状同时约束动作与目标。 */
export function isTeamAuditEvent(v: unknown): v is TeamAuditEvent {
  if (
    !isRecord(v) ||
    !hasExactKeys(v, ['id', 'at', 'actor', 'action', 'member', 'target', 'state', 'outcome']) ||
    !isPlanId(v.id) ||
    !isBatchTime(v.at) ||
    !isRecord(v.actor) ||
    !hasExactKeys(v.actor, ['id', 'username']) ||
    !isPlanId(v.actor.id) ||
    typeof v.actor.username !== 'string' ||
    !/^[a-z][a-z0-9_.-]{2,31}$/.test(v.actor.username) ||
    typeof v.action !== 'string' ||
    !Object.hasOwn(teamAuditActions, v.action)
  )
    return false
  if (v.action.startsWith('member_')) {
    return (
      v.state === 'atomic' &&
      v.target === null &&
      v.outcome === null &&
      isRecord(v.member) &&
      hasExactKeys(v.member, ['before', 'after']) &&
      (v.member.before === null || safeMember(v.member.before)) &&
      safeMember(v.member.after)
    )
  }
  return (
    v.member === null &&
    isTeamAuditTarget(v.target) &&
    ['matched', 'unmatched'].includes(String(v.state)) &&
    (v.outcome === null ||
      (isRecord(v.outcome) &&
        hasExactKeys(v.outcome, ['id', 'status', 'code', 'finishedAt']) &&
        isPlanId(v.outcome.id) &&
        [v.outcome.status, v.outcome.code].every(
          (x) => typeof x === 'string' && /^[a-z_]{1,80}$/.test(x),
        ) &&
        (v.outcome.finishedAt === null || isBatchTime(v.outcome.finishedAt))))
  )
}
/** 分页总数与实际条数共同校验，不把损坏响应当空历史。 */
export function isTeamAuditPage(v: unknown): v is TeamAuditPage {
  return (
    isRecord(v) &&
    hasExactKeys(v, ['items', 'total', 'page']) &&
    Array.isArray(v.items) &&
    v.items.length <= 50 &&
    v.items.every(isTeamAuditEvent) &&
    Number.isSafeInteger(v.total) &&
    Number(v.total) >= v.items.length &&
    Number.isSafeInteger(v.page) &&
    Number(v.page) >= 1
  )
}
