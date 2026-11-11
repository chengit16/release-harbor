/** @description 在线身份值与入参边界；发行者来自启动配置，subject 仅来自 IdP 或管理员预登记。 */
import { createHash, randomBytes } from 'node:crypto'
import {
  hostedRoles,
  isRecord,
  type CreateHostedMember,
  type HostedRole,
} from '@release-harbor/contracts'
import { DomainError } from '@release-harbor/domain'

/** 经过 OIDC 验证的稳定用户身份。 */
export interface HostedIdentity {
  /** 已配置并经验证的 OIDC 发行者。 */
  issuer: string
  /** 该发行者对当前客户端返回的稳定 subject。 */
  subject: string
}

/** 一次登录事务由服务端持有，用来绑定回调与发起浏览器。 */
export interface LoginFlow {
  /** 关联授权响应的随机 state。 */
  state: string
  /** 关联 ID Token 的随机 nonce。 */
  nonce: string
  /** PKCE 交换材料，不能下发给浏览器。 */
  verifier: string
}

/** 生成会话或登录 Cookie 的不透明随机值。 */
export function randomToken(): string {
  return randomBytes(32).toString('base64url')
}

/** 仅把格式正确的会话随机值转换为可持久化摘要。 */
export function tokenDigest(token: unknown): string | undefined {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return
  return createHash('sha256').update(token).digest('hex')
}

/** 路由 ID 只是定位，校验格式后仍须在查询中限定可信工作空间。 */
export function hostedId(id: string): string {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id))
    throw new DomainError('资源不存在', 404)
  return id
}

/** 拒绝额外字段，避免客户端声明可信归属或成员状态。 */
export function exactFields(input: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!isRecord(input) || Object.keys(input).some((field) => !fields.includes(field)))
    throw new DomainError('资料格式不正确或包含不支持的字段')
  return input
}

/** 校验显示名称；不将显示名称用于授权。 */
export function hostedLabel(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim().length > 60 ||
    /[\u0000-\u001f]/.test(value)
  )
    throw new DomainError('显示名称需为 1–60 个可显示字符')
  return value.trim()
}

/** subject 区分大小写，不做修剪或邮箱归一化。 */
export function hostedSubject(value: unknown): string {
  if (typeof value !== 'string' || !/^[\x21-\x7e]{1,255}$/.test(value))
    throw new DomainError('请输入身份提供方返回的有效 subject')
  return value
}

/** 只接受当前公开的三个角色。 */
export function hostedRole(value: unknown): HostedRole {
  const role = hostedRoles.find((candidate) => candidate === value)
  if (!role) throw new DomainError('请选择有效的工作空间角色')
  return role
}

/** 按管理员给定的已知身份预登记成员；不接收空间或发行者字段。 */
export function hostedMemberInput(input: unknown): CreateHostedMember {
  const data = exactFields(input, ['subject', 'label', 'role'])
  return {
    subject: hostedSubject(data.subject),
    label: hostedLabel(data.label),
    role: hostedRole(data.role),
  }
}
