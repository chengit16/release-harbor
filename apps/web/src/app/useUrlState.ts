/** @description URL 驱动的只读页面定位；共享订阅覆盖浏览器前后退和本应用 pushState，不携带敏感状态。 */
import { useSyncExternalStore } from 'react'
const event = 'harbor:url-change'
function subscribe(listener: () => void): () => void {
  window.addEventListener('popstate', listener)
  window.addEventListener(event, listener)
  return () => {
    window.removeEventListener('popstate', listener)
    window.removeEventListener(event, listener)
  }
}
/** URL 字符串作为稳定快照，避免每次读取新对象触发循环渲染。 */
export function useUrlState(): URLSearchParams {
  return new URLSearchParams(useSyncExternalStore(subscribe, () => window.location.search))
}
/** 只修改明确的查询字段，保留项目定位；搜索可替换当前历史，查看详情形成新历史。 */
export function updateUrlState(patch: Record<string, string>, replace = false): void {
  const url = new URL(window.location.href)
  for (const [key, value] of Object.entries(patch)) {
    if (value) url.searchParams.set(key, value)
    else url.searchParams.delete(key)
  }
  if (url.href === window.location.href) return
  window.history[replace ? 'replaceState' : 'pushState'](null, '', url)
  window.dispatchEvent(new Event(event))
}
/** 全局菜单恢复仅涉及已实现页面，不产生业务写操作。 */
export function useWorkbenchView(): {
  view: 'releases' | 'projects' | 'issues' | 'accounts' | 'channels' | 'roadmap'
  setView: (value: string) => void
} {
  const params = useUrlState(),
    candidate = params.get('view')
  const tab = params.get('tab')
  const legacyPlans =
    (tab === 'plans' || tab === 'apple-review') &&
    (!candidate || candidate === 'projects' || candidate === 'releases')
  const legacyProjectTab =
    candidate === 'releases' &&
    Boolean(params.get('project') && params.get('application')) &&
    (tab === 'bindings' || tab === 'artifacts' || tab === 'preflight')
  const view = legacyPlans
    ? 'releases'
    : legacyProjectTab
      ? 'projects'
      : candidate === 'releases' ||
          candidate === 'projects' ||
          candidate === 'issues' ||
          candidate === 'accounts' ||
          candidate === 'channels' ||
          candidate === 'roadmap'
        ? candidate
        : params.get('project')
          ? 'projects'
          : 'releases'
  return {
    view,
    setView: (value: string) =>
      updateUrlState({
        view: value,
        ...(value === 'releases' || tab === 'plans' || tab === 'apple-review'
          ? {
              releaseTask: '',
              tab: '',
              plan: '',
              batch: '',
              batchRevision: '',
              releaseApple: '',
              appleRecord: '',
            }
          : {}),
      }),
  }
}
