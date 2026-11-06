/** @description 商店状态观察同源接口；GET 只读本机历史，POST 仅显式触发固定目标的只读查询。 */
import { isReleaseObservation, type ReleaseObservation } from '@release-harbor/contracts'
import { request, items, item, json } from '../client.ts'
function root(project: string, application: string, plan: string): string {
  return `/api/projects/${encodeURIComponent(project)}/applications/${encodeURIComponent(application)}/release-plans/${encodeURIComponent(plan)}/observations`
}
/** 刷新页面只恢复本机记录，取消请求不会自动重试。 */
export function listReleaseObservations(
  project: string,
  application: string,
  plan: string,
  signal: AbortSignal,
): Promise<ReleaseObservation[]> {
  return request(root(project, application, plan), items(isReleaseObservation), {
    signal,
    cache: 'no-store',
  })
}
/** 明确点击后查询；网络等待中关闭页面不撤销已经开始的只读查询，可重读历史核对。 */
export function queryReleaseObservation(
  project: string,
  application: string,
  plan: string,
  signal: AbortSignal,
): Promise<ReleaseObservation> {
  return request(
    root(project, application, plan),
    item('observation', isReleaseObservation),
    {
      ...json('POST', {}, signal),
      headers: { 'Content-Type': 'application/json', 'X-Release-Harbor-Plan': '1' },
    },
    175000,
  )
}
