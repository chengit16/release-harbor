/** @description URL 驱动的只读页面定位；共享订阅覆盖浏览器前后退和本应用 pushState，不携带敏感状态。 */
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
/** URL 字符串作为稳定快照，避免每次读取新对象触发循环渲染。 */
export function useUrlState(): URLSearchParams {
  return new URLSearchParams(useSyncExternalStore(subscribe, () => window.location.search))
}
/** 浏览器历史只保存返回列表筛选，不包含表单、凭据、执行授权或业务事实。 */
function savedReleaseList(): string {
  const state: unknown = window.history.state
  if (!state || typeof state !== 'object' || !('harborReleaseList' in state)) return ''
  const search = state.harborReleaseList
  return typeof search === 'string' ? releaseListSearch(new URLSearchParams(search)) : ''
}

/** 生成独立列表链接；刷新保留当前历史项的返回筛选，直接打开深链则回到默认列表。 */
export function releaseCenterUrl(): URL {
  const url = new URL(window.location.href)
  url.search = savedReleaseList() || releaseListSearch(url.searchParams)
  return url
}

/** 按页面归属更新 URL；显式菜单跳转从空状态开始，同页筛选可替换历史。 */
export function updateUrlState(patch: Record<string, string>, replace = false): void {
  const url = new URL(window.location.href)
  const current = normalizeWorkbenchSearch(url.searchParams)
  const crossing = Boolean(patch.view && patch.view !== current.get('view'))
  const next = crossing ? new URLSearchParams() : new URLSearchParams(current)
  // 1. 从工作区返回列表时恢复当前历史项的筛选，避免让列表参数常驻详情 URL。
  if (!crossing && current.get('releaseTask') === 'workspace' && patch.releaseTask === '') {
    const list = releaseCenterUrl().searchParams
    for (const [key, value] of list) next.set(key, value)
  }
  // 2. 显式目标覆盖当前定位，再按页面和模式清理无效字段。
  for (const [key, value] of Object.entries(patch)) {
    if (value) next.set(key, value)
    else next.delete(key)
  }
  url.search = normalizeWorkbenchSearch(next).toString()
  if (url.href === window.location.href) return
  // 3. 返回筛选跟随详情历史项，刷新和前后退不依赖全局缓存，也不保存发布草稿。
  const workspace = url.searchParams.get('releaseTask') === 'workspace'
  const returnSearch = workspace
    ? crossing
      ? releaseListSearch(new URLSearchParams())
      : savedReleaseList() || releaseListSearch(new URL(window.location.href).searchParams)
    : ''
  window.history[replace ? 'replaceState' : 'pushState'](
    returnSearch ? { harborReleaseList: returnSearch } : null,
    '',
    url,
  )
  window.dispatchEvent(new Event(event))
}

/** 全局菜单回到干净入口；旧深链原位规范化，不新增历史或触发业务动作。 */
export function useWorkbenchView(): {
  /** 当前菜单，历史帮助 URL 继续可读。 */
  view: WorkbenchView
  /** 菜单点击重置当前筛选，详情返回使用独立入口保留筛选。 */
  setView: (value: string) => void
} {
  const params = useUrlState()
  const view = resolveWorkbenchView(params)
  const search = params.toString()
  useEffect(() => {
    updateUrlState({}, true)
  }, [search])
  return {
    view,
    setView: (value: string) => {
      const url = new URL(window.location.href)
      url.search = normalizeWorkbenchSearch(new URLSearchParams({ view: value })).toString()
      if (url.href === window.location.href) return
      window.history.pushState(null, '', url)
      window.dispatchEvent(new Event(event))
    },
  }
}
