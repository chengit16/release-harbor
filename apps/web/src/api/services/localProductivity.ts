/** @description 本机空间、诊断与配置复用 API；显式写操作带来源标记，下载使用受控资源地址。 */
import {
  isLocalStorageView,
  isReleasePreset,
  isRuntimeCheck,
  isRecord,
  type ReusableEntry,
  type ReleasePreset,
  type LocalStorageView,
  type RuntimeCheck,
} from '@release-harbor/contracts'
import { request, items, json } from '../client.ts'
const write = (body: unknown) => ({
  ...json('POST', body),
  headers: { 'Content-Type': 'application/json', 'X-Release-Harbor-Local': '1' },
})
const ok = (v: unknown) => {
  if (!isRecord(v) || v.ok !== true) throw Error('操作响应不正确，请刷新核对')
}
/** 仅读取实际占用，不触发清理或检查。 */
export function readLocalStorage(signal?: AbortSignal): Promise<LocalStorageView> {
  return request(
    '/api/local/storage',
    (v) => {
      if (!isLocalStorageView(v)) throw Error('存储目录格式不正确')
      return v
    },
    { signal, cache: 'no-store' },
  )
}
/** 批量清理须由调用方展示影响并明确确认。 */
export function cleanupArtifacts(ids: string[]): Promise<void> {
  return request('/api/local/artifacts/cleanup', ok, write({ ids, acknowledged: true }), 120000)
}
/** 下载地址不包含本机路径；服务端验证归属与实际摘要。 */
export function artifactDownloadUrl(projectId: string, applicationId: string, id: string): string {
  return `/api/local/artifacts/${encodeURIComponent(projectId)}/${encodeURIComponent(applicationId)}/${encodeURIComponent(id)}/download`
}
/** 删除受控备份，不影响外部已下载文件。 */
export function deleteLocalBackups(ids: string[]): Promise<void> {
  return request('/api/local/backups/delete', ok, write({ ids, acknowledged: true }))
}
/** 工具检查仅报告本机情况，不验证商店权限。 */
export function readRuntimeChecks(signal?: AbortSignal): Promise<RuntimeCheck[]> {
  return request('/api/local/diagnostics', items(isRuntimeCheck), { signal, cache: 'no-store' })
}
const reuseRoot = (p: string, a: string) =>
  `/api/local/reuse/${encodeURIComponent(p)}/${encodeURIComponent(a)}`
/** 模板与历史返回配置字段白名单，不返回原快照或授权。 */
export function readReleasePresets(
  p: string,
  a: string,
  signal?: AbortSignal,
): Promise<ReleasePreset[]> {
  return request(reuseRoot(p, a), items(isReleasePreset), { signal, cache: 'no-store' })
}
/** 当前表单显式保存模板，不触发发布准备。 */
export function saveReleasePreset(
  p: string,
  a: string,
  name: string,
  kind: ReleasePreset['kind'],
  entries: ReusableEntry[],
): Promise<void> {
  return request(reuseRoot(p, a), ok, write({ name, kind, entries }))
}
/** 历史配置不可删除，此入口只作用于用户模板。 */
export function deleteReleasePreset(p: string, a: string, id: string): Promise<void> {
  return request(reuseRoot(p, a) + '/delete', ok, write({ id }))
}
