/** @description 在线目录服务；全部请求同源，登录状态交给 HttpOnly Cookie。 */
import {
  frameworks,
  hostedRoles,
  isApplication,
  isChannelBinding,
  isRecord,
  type HostedMember,
  type HostedWorkspace,
  type Project,
} from '@release-harbor/contracts'
import { item, items, json, request } from '../api/client.ts'

const base = '/api/hosted'

function isWorkspace(value: unknown): value is HostedWorkspace {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.key === 'string' &&
    hostedRoles.some((role) => role === value.role)
  )
}

function isMember(value: unknown): value is HostedMember {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.label === 'string' &&
    hostedRoles.some((role) => role === value.role)
  )
}

function isProject(value: unknown): value is Project {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.workspaceId === 'string' &&
    typeof value.name === 'string' &&
    typeof value.key === 'string' &&
    frameworks.some((framework) => framework === value.framework) &&
    typeof value.description === 'string' &&
    typeof value.createdAt === 'string'
  )
}

function workspaceList(value: unknown): value is HostedWorkspace[] {
  return Array.isArray(value) && value.every(isWorkspace)
}

/** 在线目录公开响应的运行时解码器。 */
export const hostedDecode = {
  workspaces: item('workspaces', workspaceList),
  projects: items(isProject),
  applications: items(isApplication),
  bindings: items(isChannelBinding),
  members: items(isMember),
}

/** 在线空间定位前缀；空间 ID 不构成授权。 */
export function workspacePath(id: string): string {
  return `/workspaces/${encodeURIComponent(id)}`
}

/** 加载在线资源，并在工作空间切换时允许取消本地等待。 */
export function hostedRead<T>(
  path: string,
  decode: (value: unknown) => T,
  signal: AbortSignal,
): Promise<T> {
  return request(base + path, decode, { signal, cache: 'no-store' })
}

/** 同源变更请求固定携带操作标记；不自动重试，也不在此维护 UI。 */
export function hostedWrite(
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body: unknown,
): Promise<void> {
  return request(base + path, () => undefined, writeInit(method, body))
}

/** 仅接受身份提供方的 HTTPS 导航，授权地址不进入持久化状态。 */
export function hostedLoginUrl(): Promise<string> {
  return request(
    base + '/auth/start',
    (value) => {
      if (
        !isRecord(value) ||
        typeof value.url !== 'string' ||
        new URL(value.url).protocol !== 'https:'
      )
        throw new Error('身份提供方响应格式不正确')
      return value.url
    },
    writeInit('POST', {}),
  )
}

function writeInit(method: string, body: unknown): RequestInit {
  const init = json(method, body)
  const headers = new Headers(init.headers)
  headers.set('X-Release-Harbor-Hosted', '1')
  return { ...init, headers, cache: 'no-store' }
}
