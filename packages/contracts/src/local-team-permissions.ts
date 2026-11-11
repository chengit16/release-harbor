/** @description 本机成员菜单、应用操作及兼容的旧渠道授权合同；不包含商店秘密。 */
import { isRecord, type ChannelBinding } from './applications.ts'
import { hasExactKeys, releaseActions } from './release-plans.ts'

/** 可分配的成员菜单；账号与本机维护只属于管理员。 */
export const teamMenus = {
  releases: '发布中心',
  reviews: '审核状态',
  projects: '应用管理（只读）',
  help: '帮助与支持',
} as const
/** 各动作独立授权，准备包含所需只读检查，但不产生确认资格。 */
export const teamOperations = {
  review_read: '查看审核缓存',
  review_query: '查询官方／检查资料',
  release_prepare: '准备发布／上传包',
  release_confirm: '确认执行',
  release_reconcile: '人工核对',
} as const
/** Apple 审核和手动发布与构建上传独立授权。 */
export const teamReleaseActions = {
  ...releaseActions,
  apple_submit_review: 'Apple 已有构建送审',
  apple_release: 'Apple 批准后手动发布',
} as const
/** 公开菜单标识。 */
export type TeamMenu = keyof typeof teamMenus
/** 公开业务动作标识。 */
export type TeamOperation = keyof typeof teamOperations
/** 真实发布动作；不能用准备或查询权限替代。 */
export type TeamReleaseAction = keyof typeof teamReleaseActions
/** 从包发布意图恢复权限动作；前端仅用于提示，服务端以可信绑定独立复核。 */
export function teamPreparationAction(
  binding: Pick<ChannelBinding, 'channel'>,
  huaweiAction?: string,
): TeamReleaseAction {
  if (binding.channel === 'app_store') return 'apple_upload_build'
  if (binding.channel === 'huawei')
    return huaweiAction === 'submit_review' ? 'huawei_submit_review' : 'huawei_save_draft'
  const actions = {
    xiaomi: 'xiaomi_submit_review',
    oppo: 'oppo_submit_review',
    vivo: 'vivo_submit_review',
    meizu: 'meizu_submit_review',
    honor: 'honor_submit_review',
    tencent: 'tencent_submit_review',
    harmony: 'harmony_submit_review',
  } as const
  return actions[binding.channel]
}
/** 明确应用和绑定的版本化授权；绑定任一配置变化后需重新分配。 */
export interface TeamBindingGrant {
  projectId: string
  applicationId: string
  bindingId: string
  /** 服务端根据当前完整绑定生成 SHA-256，客户端仅回送用于防止陈旧授权。 */
  fingerprint: string
  operations: TeamOperation[]
  releaseActions: TeamReleaseAction[]
}
/** 应用级授权覆盖该应用当前及后续渠道；操作独立分配，不产生执行许可。 */
export interface TeamApplicationGrant {
  projectId: string
  applicationId: string
  operations: TeamOperation[]
}
/** 安装级权限投影；缺省为无权限，revision 用于防止并发覆盖。 */
export interface LocalTeamPermissions {
  revision: number
  menus: TeamMenu[]
  /** 兼容旧渠道授权；不自动扩大为应用授权。 */
  grants: TeamBindingGrant[]
  /** 新授权按应用保存；省略兼容旧账号目录。 */
  applications?: TeamApplicationGrant[]
}
/** 校验传输和磁盘边界，安全授权拒绝额外字段及重复范围。 */
export function isLocalTeamPermissions(value: unknown): value is LocalTeamPermissions {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'revision',
      'menus',
      'grants',
      ...(Object.hasOwn(value, 'applications') ? ['applications'] : []),
    ]) &&
    Number.isSafeInteger(value.revision) &&
    typeof value.revision === 'number' &&
    value.revision >= 0 &&
    choices(value.menus, teamMenus) &&
    Array.isArray(value.grants) &&
    value.grants.length <= 500 &&
    value.grants.every(isGrant) &&
    new Set(value.grants.map((g) => `${g.projectId}/${g.applicationId}/${g.bindingId}`)).size ===
      value.grants.length &&
    (value.applications === undefined ||
      (Array.isArray(value.applications) &&
        value.applications.length <= 500 &&
        value.applications.every(
          (g) =>
            isRecord(g) &&
            hasExactKeys(g, ['projectId', 'applicationId', 'operations']) &&
            ['projectId', 'applicationId'].every(
              (k) => typeof g[k] === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(g[k]),
            ) &&
            choices(g.operations, teamOperations),
        ) &&
        new Set(value.applications.map((g) => `${g.projectId}/${g.applicationId}`)).size ===
          value.applications.length))
  )
}
function choices(value: unknown, allowed: object): boolean {
  return (
    Array.isArray(value) &&
    value.every((v) => typeof v === 'string' && Object.hasOwn(allowed, v)) &&
    new Set(value).size === value.length
  )
}
function isGrant(value: unknown): value is TeamBindingGrant {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'projectId',
      'applicationId',
      'bindingId',
      'fingerprint',
      'operations',
      'releaseActions',
    ]) &&
    ['projectId', 'applicationId', 'bindingId'].every(
      (k) => typeof value[k] === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value[k]),
    ) &&
    typeof value.fingerprint === 'string' &&
    /^[a-f0-9]{64}$/.test(value.fingerprint) &&
    choices(value.operations, teamOperations) &&
    choices(value.releaseActions, teamReleaseActions)
  )
}

/** 管理员应用候选；未绑定渠道的应用也可预先分配权限。 */
export interface TeamGrantOption {
  projectId: string
  applicationId: string
  label: string
  platform: string
  channels: string[]
}
/** 管理候选列表的传输校验。 */
export function isTeamGrantOption(value: unknown): value is TeamGrantOption {
  return (
    isRecord(value) &&
    ['projectId', 'applicationId', 'label', 'platform'].every(
      (k) => typeof value[k] === 'string',
    ) &&
    Array.isArray(value.channels) &&
    value.channels.every((c) => typeof c === 'string')
  )
}
