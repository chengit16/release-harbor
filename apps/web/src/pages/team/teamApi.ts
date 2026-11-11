/** @description 本机团队同源接口；登录口令不缓存，会话仅由浏览器的 HttpOnly Cookie 承载。 */
import {
  isLocalTeamMember,
  isTeamAuditPage,
  isTeamGrantOption,
  isLocalTeamSession,
  isRecord,
  type LocalTeamMember,
  type LocalTeamSession,
} from '@release-harbor/contracts'
import { items, json, request } from '../../api/client.ts'

const path = '/api/team'

/** 由服务端判断个人或团队模式，未知响应不得当作未启用团队。 */
export function teamSession(signal?: AbortSignal): Promise<LocalTeamSession> {
  return request(
    path + '/session',
    (value) => {
      if (!isLocalTeamSession(value)) throw new Error('本机会话状态无法读取')
      return value
    },
    { signal, cache: 'no-store' },
  )
}

/** 本机账号输入，仅用于当前表单提交。 */
export interface TeamCredentials {
  username: string
  password: string
}

/** 提交账号登录，成功后调用方重新读取当前身份。 */
export function signInTeam(value: TeamCredentials): Promise<void> {
  return mutate('/login', value, checked)
}

/** 撤销当前浏览器会话。 */
export function signOutTeam(): Promise<void> {
  return mutate('/logout', {}, checked)
}

/** 读取管理员可见的成员安全投影。 */
export function teamMembers(signal: AbortSignal): Promise<LocalTeamMember[]> {
  return request(path + '/members', items(isLocalTeamMember), { signal, cache: 'no-store' })
}

/** 创建默认没有业务权限的本机成员。 */
export function addTeamMember(value: TeamCredentials): Promise<LocalTeamMember> {
  return mutate('/members', value, member)
}

/** 更新成员登录资格或重置密码；旧会话不会继续使用。 */
export function updateTeamMember(
  id: string,
  value: { action: 'enable' | 'disable' } | { action: 'reset'; password: string },
): Promise<LocalTeamMember> {
  return mutate('/members/' + encodeURIComponent(id), value, member)
}

function mutate<T>(part: string, input: unknown, decode: (value: unknown) => T): Promise<T> {
  const init = json('POST', input)
  const headers = new Headers(init.headers)
  headers.set('X-Release-Harbor-Team', '1')
  return request(path + part, decode, { ...init, headers, cache: 'no-store' })
}

function checked(value: unknown): void {
  if (!isRecord(value) || value.ok !== true) throw new Error('未能确认本机团队操作')
}

function member(value: unknown): LocalTeamMember {
  if (!isLocalTeamMember(value)) throw new Error('本机成员信息无法读取')
  return value
}

/** 管理员读取应用授权候选，应用归属及渠道数量只由服务端产生。 */
export function teamGrantOptions(
  signal: AbortSignal,
): Promise<import('@release-harbor/contracts').TeamGrantOption[]> {
  return request(path + '/grant-options', items(isTeamGrantOption), { signal, cache: 'no-store' })
}
/** 管理员显式替换成员授权，冲突时保留窗口草稿供核对。 */
export function setTeamPermissions(
  id: string,
  value: import('@release-harbor/contracts').LocalTeamPermissions,
): Promise<LocalTeamMember> {
  return mutate('/members/' + encodeURIComponent(id) + '/permissions', value, member)
}

/** 管理员分页读取日志；全部筛选由服务端执行，不缓存账号信息。 */
export function teamAudit(
  filter: import('@release-harbor/contracts').TeamAuditFilter,
  signal: AbortSignal,
): Promise<import('@release-harbor/contracts').TeamAuditPage> {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(filter))
    if (value !== undefined && value !== '') query.set(key, String(value))
  return request(path + '/audit?' + query, auditPage, { signal, cache: 'no-store' })
}
/** 按原发布记录查询操作者；服务端重新核对当前身份和原目标。 */
export function teamRecordAudit(
  target: Pick<
    import('@release-harbor/contracts').TeamAuditTarget,
    'projectId' | 'applicationId' | 'kind' | 'recordId'
  >,
  page: number,
  signal: AbortSignal,
): Promise<import('@release-harbor/contracts').TeamAuditPage> {
  const parts = [target.projectId, target.applicationId, target.kind, target.recordId].map(
    encodeURIComponent,
  )
  return request(path + '/records/' + parts.join('/') + '?page=' + page, auditPage, {
    signal,
    cache: 'no-store',
  })
}
function auditPage(value: unknown): import('@release-harbor/contracts').TeamAuditPage {
  if (!isTeamAuditPage(value)) throw new Error('操作日志无法读取')
  return value
}
