/** @description 只读预检公开 API，只提交对象引用与版本，凭据材料不进入浏览器。 */
import {
  isPreflightRecord,
  isPreflightView,
  isProfileCatalog,
  type CreatePreflight,
  type PreflightRecord,
  type PreflightView,
  type ProfileCatalog,
} from '@release-harbor/contracts'
import { item, items, json, request } from '../client.ts'

function root(projectId: string, applicationId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/applications/${encodeURIComponent(applicationId)}/preflights`
}

/** 读取安全档案目录，打开页面不触发鉴权。 */
export function listProfiles(signal: AbortSignal): Promise<ProfileCatalog> {
  return request('/api/profiles', item('catalog', isProfileCatalog), { signal })
}

/** 读取历史事实和当前失效原因，不重新请求商店。 */
export function listPreflights(
  projectId: string,
  applicationId: string,
  signal: AbortSignal,
): Promise<PreflightView[]> {
  return request(root(projectId, applicationId), items(isPreflightView), { signal })
}

/** 202 只表示任务已登记；离开页面不承诺取消已开始的只读请求。 */
export function startPreflight(
  projectId: string,
  applicationId: string,
  input: CreatePreflight,
  signal: AbortSignal,
): Promise<PreflightRecord> {
  return request(
    root(projectId, applicationId),
    item('preflight', isPreflightRecord),
    json('POST', input, signal),
  )
}
