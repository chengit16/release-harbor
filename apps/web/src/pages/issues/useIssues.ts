/** @description 问题目录加载与 URL 筛选；业务事实来自只读 API，前后退只恢复定位，不重新执行商店检查。 */
import { useEffect, useState } from 'react'
import {
  issueCategories,
  issueStatuses,
  channelLabels,
  type IssueCatalog,
  type IssueRecord,
} from '@release-harbor/contracts'
import { fetchIssues } from '../../api/services/issues.ts'
import { updateUrlState, useUrlState } from '../../app/useUrlState.ts'
/** 固定列数之外的筛选字段全部是公开文本；原始未知 URL 值不参与过滤。 */
export interface IssueFilters {
  query: string
  category: string
  channel: string
  status: string
}
/** 空白分词均须匹配，中文支持子串，不把状态名或内部错误码当作解决结论。 */
export function filterIssues(items: IssueRecord[], filters: IssueFilters): IssueRecord[] {
  const terms = filters.query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
  return items.filter(
    (i) =>
      (!filters.category || i.category === filters.category) &&
      (!filters.channel || i.channels.some((c) => c === filters.channel)) &&
      (!filters.status || i.status === filters.status) &&
      terms.every((t) =>
        [
          i.id,
          i.title,
          i.symptoms,
          i.rootCause.detail,
          i.solution,
          i.verification.detail,
          i.prevention,
        ]
          .join(' ')
          .toLocaleLowerCase()
          .includes(t),
      ),
  )
}
/** 问题页面加载状态与明确用户定位动作；没有任何写入业务数据的端口。 */
export interface IssuesState {
  catalog: IssueCatalog | null
  error: string
  loading: boolean
  filters: IssueFilters
  visible: IssueRecord[]
  page: number
  selected: string
  issue: IssueRecord | undefined
  refresh: () => void
  filter: (values: Partial<IssueFilters>, replace?: boolean) => void
  setPage: (page: number) => void
  select: (id: string) => void
  clear: () => void
}
/** 原编号在筛选外仍可查看，加载与定位相互独立；清理请求防止卸载或重读后的旧响应覆盖。 */
export function useIssues(): IssuesState {
  const [catalog, setCatalog] = useState<IssueCatalog | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0)
  const params = useUrlState()
  // 1. 只在进入页面或明确重读时获取目录，筛选不重复请求。
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    void fetchIssues(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setCatalog(data)
      })
      .catch((failure) => {
        if (!controller.signal.aborted) {
          setCatalog(null)
          setError(failure instanceof Error ? failure.message : '问题档案读取失败')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [revision])
  // 2. 白名单解析 URL；未知选项回到全部，越界页码仅影响展示，不读取额外资源。
  const category = params.get('issueCategory') ?? '',
    channel = params.get('issueChannel') ?? '',
    status = params.get('issueStatus') ?? ''
  const filters: IssueFilters = {
    query: (params.get('issueQ') ?? '').slice(0, 200),
    category: Object.hasOwn(issueCategories, category) ? category : '',
    channel: channel === 'common' || Object.hasOwn(channelLabels, channel) ? channel : '',
    status: Object.hasOwn(issueStatuses, status) ? status : '',
  }
  const visible = filterIssues(catalog?.items ?? [], filters).sort(
    (a, b) =>
      b.updatedDate.localeCompare(a.updatedDate) ||
      { high: 0, medium: 1, low: 2 }[a.severity] - { high: 0, medium: 1, low: 2 }[b.severity] ||
      a.id.localeCompare(b.id),
  )
  const candidate = params.get('issuePage') ?? '1',
    requested = /^[1-9]\d{0,5}$/.test(candidate) ? Number(candidate) : 1
  const page = Math.min(requested, Math.max(1, Math.ceil(visible.length / 10)))
  const selected = params.get('issue') ?? ''
  // 3. 查看和筛选只修改公开定位，搜索替换历史，其他选择可前后退。
  return {
    catalog,
    error,
    loading,
    filters,
    visible,
    page,
    selected,
    issue: catalog?.items.find((i) => i.id === selected),
    refresh: () => setRevision((v) => v + 1),
    filter: (values: Partial<IssueFilters>, replace = false) =>
      updateUrlState(
        {
          issuePage: '',
          ...('query' in values ? { issueQ: values.query ?? '' } : {}),
          ...('category' in values ? { issueCategory: values.category ?? '' } : {}),
          ...('channel' in values ? { issueChannel: values.channel ?? '' } : {}),
          ...('status' in values ? { issueStatus: values.status ?? '' } : {}),
        },
        replace,
      ),
    setPage: (n: number) => updateUrlState({ issuePage: n > 1 ? String(n) : '' }),
    select: (id: string) => updateUrlState({ issue: id }),
    clear: () =>
      updateUrlState({
        issueQ: '',
        issueCategory: '',
        issueChannel: '',
        issueStatus: '',
        issuePage: '',
      }),
  }
}
