/** @description 工作台导航状态：地址栏仅保留菜单，公开页面定位随浏览器历史保存；旧长链接只导入定位，不触发业务动作。 */
import { useEffect, useSyncExternalStore } from 'react'
import {
  normalizeWorkbenchSearch,
  releaseListSearch,
  resolveWorkbenchView,
  type WorkbenchView,
} from './urlNavigation.ts'

const event = 'harbor:url-change'

function subscribe(listener: () => void): () => void {
  window.addEventListener('popstate', listener)
  window.addEventListener(event, listener)
  return () => {
    window.removeEventListener('popstate', listener)
    window.removeEventListener(event, listener)
  }
}

/** 只接受本工作台版本的导航数据；历史记录不含表单草稿、凭据、执行授权或业务事实。 */
function savedNavigation(): { search: string; releaseList: string } | undefined {
  const state: unknown = window.history.state
  if (!state || typeof state !== 'object' || !('harborNavigation' in state)) return
  const entry = state.harborNavigation
  if (
    !entry ||
    typeof entry !== 'object' ||
    !('version' in entry) ||
    entry.version !== 1 ||
    !('search' in entry) ||
    typeof entry.search !== 'string'
  )
    return
  return {
    search: entry.search,
    releaseList:
      'releaseList' in entry && typeof entry.releaseList === 'string' && entry.releaseList
        ? releaseListSearch(new URLSearchParams(entry.releaseList))
        : '',
  }
}

/** 读取当前公开定位；旧查询参数优先导入，短地址只恢复菜单匹配的当前历史项。 */
export function readNavigationSearch(): string {
  const address = new URLSearchParams(window.location.search)
  if ([...address.keys()].some((key) => key !== 'view'))
    return normalizeWorkbenchSearch(address).toString()
  const saved = savedNavigation()
  const params = saved ? normalizeWorkbenchSearch(new URLSearchParams(saved.search)) : undefined
  return params && params.get('view') === resolveWorkbenchView(address)
    ? params.toString()
    : normalizeWorkbenchSearch(address).toString()
}

/** 稳定字符串快照同时覆盖同一短地址的不同历史项，前后退不能只比较 location.search。 */
export function useUrlState(): URLSearchParams {
  return new URLSearchParams(useSyncExternalStore(subscribe, readNavigationSearch))
}

function returnListSearch(): string {
  const state = savedNavigation()
  if (state?.releaseList) return state.releaseList
  // 兼容上一版历史项，以及首次打开仍带发布列表筛选的旧长链接。
  const legacy: unknown = window.history.state
  if (
    legacy &&
    typeof legacy === 'object' &&
    'harborReleaseList' in legacy &&
    typeof legacy.harborReleaseList === 'string'
  )
    return releaseListSearch(new URLSearchParams(legacy.harborReleaseList))
  return releaseListSearch(new URLSearchParams(window.location.search))
}

/** 面包屑的新标签页只进入发布中心；当前标签页通过历史状态恢复返回筛选。 */
export function releaseCenterUrl(): URL {
  const url = new URL(window.location.href)
  url.search = new URLSearchParams({ view: 'releases' }).toString()
  return url
}

function writeNavigation(params: URLSearchParams, releaseList: string, replace: boolean): void {
  const search = params.toString()
  const url = new URL(window.location.href)
  url.search = new URLSearchParams({ view: resolveWorkbenchView(params) }).toString()
  const saved = savedNavigation()
  if (
    url.href === window.location.href &&
    saved?.search === search &&
    saved.releaseList === releaseList
  )
    return
  // 相同地址也可能是不同详情或筛选：历史项携带完整白名单定位，刷新仍恢复当前页。
  window.history[replace ? 'replaceState' : 'pushState'](
    { harborNavigation: { version: 1, search, releaseList } },
    '',
    url,
  )
  window.dispatchEvent(new Event(event))
}

/** 按页面归属更新历史定位；地址栏仅写菜单，显式选择形成历史，输入筛选可替换当前项。 */
export function updateUrlState(patch: Record<string, string>, replace = false): void {
  const current = new URLSearchParams(readNavigationSearch())
  const crossing = Boolean(patch.view && patch.view !== current.get('view'))
  const next = crossing ? new URLSearchParams() : new URLSearchParams(current)
  // 1. 返回列表只恢复本历史项的筛选，跨菜单不携带其他页面状态。
  if (!crossing && current.get('releaseTask') === 'workspace' && patch.releaseTask === '') {
    for (const [key, value] of new URLSearchParams(returnListSearch())) next.set(key, value)
  }
  // 2. 页面输入和旧链接共用白名单规则，历史状态不能携带秘密或替代服务端授权。
  for (const [key, value] of Object.entries(patch)) {
    if (value) next.set(key, value)
    else next.delete(key)
  }
  const normalized = normalizeWorkbenchSearch(next)
  // 3. 返回筛选跟随详情历史项，独立短链接不从其他标签页或全局存储猜测当前应用。
  const releaseList =
    normalized.get('releaseTask') === 'workspace'
      ? crossing
        ? releaseListSearch(new URLSearchParams())
        : current.get('releaseTask') === 'workspace'
          ? returnListSearch()
          : releaseListSearch(current)
      : ''
  writeNavigation(normalized, releaseList, replace)
}

/** 菜单回到独立入口；同菜单下也可重置详情，旧链接原位导入且不增加历史。 */
export function useWorkbenchView(): {
  /** 当前菜单，历史帮助 URL 继续可读。 */
  view: WorkbenchView
  /** 只导航到菜单首页；查看详情和返回列表由页面明确更新定位。 */
  setView: (value: string) => void
} {
  const params = useUrlState()
  const address = useSyncExternalStore(subscribe, () => window.location.search)
  const search = params.toString()
  useEffect(() => {
    updateUrlState({}, true)
  }, [search, address])
  return {
    view: resolveWorkbenchView(params),
    setView: (value: string) =>
      writeNavigation(normalizeWorkbenchSearch(new URLSearchParams({ view: value })), '', false),
  }
}
