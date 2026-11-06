/** @description 批次同源 API；仅提交公开意图，失败先查询同一请求，不自动重试写入。 */
import { isReleaseBatch, type ReleaseBatch } from '@release-harbor/contracts'
import { item, items, json, request } from '../client.ts'
function root(p: string, a: string): string {
  return `/api/projects/${encodeURIComponent(p)}/applications/${encodeURIComponent(a)}/release-batches`
}
/** 读取原进度，不查询商店或启动任务。 */
export function listReleaseBatches(
  p: string,
  a: string,
  signal: AbortSignal,
): Promise<ReleaseBatch[]> {
  return request(root(p, a), items(isReleaseBatch), { signal, cache: 'no-store' })
}
/** 已展示意图的显式变更；写路径由组件用例固定，不能带执行路径或秘密。 */
export function mutateReleaseBatch(
  p: string,
  a: string,
  path: string,
  body: unknown,
  signal: AbortSignal,
  method = 'POST',
): Promise<ReleaseBatch> {
  return request(root(p, a) + path, item('batch', isReleaseBatch), {
    ...json(method, body, signal),
    headers: { 'Content-Type': 'application/json', 'X-Release-Harbor-Plan': '1' },
  })
}
