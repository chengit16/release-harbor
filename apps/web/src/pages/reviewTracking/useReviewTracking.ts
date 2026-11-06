/** @description 审核状态菜单的只读加载与 URL 筛选；取消旧请求以隔离页面切换，记录错误不伪装成空数据。 */
import { useEffect, useState } from 'react'
import type { ReviewTrackingResponse } from '@release-harbor/contracts'
import { updateUrlState, useUrlState } from '../../app/useUrlState.ts'
import { loadReviewTracking } from '../../api/services/reviewTracking.ts'
/** 空值代表全部筛选，未知定位保留为空结果，不任意选择其他记录。 */
export interface ReviewFilters {
  project: string
  application: string
  channel: string
  state: string
  todo: string
}
/** URL 是筛选与详情的事实来源；只有查询面板的明确动作才访问商店。 */
export function useReviewTracking() {
  const [response, setResponse] = useState<ReviewTrackingResponse | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0)
  // 1. URL 保存明确筛选及记录定位，未知值不被替换为其他目标。
  const params = useUrlState()
  const filters: ReviewFilters = {
    project: params.get('reviewProject') ?? '',
    application: params.get('reviewApplication') ?? '',
    channel: params.get('reviewChannel') ?? '',
    state: params.get('reviewState') ?? '',
    todo: params.get('reviewTodo') ?? '',
  }
  // 2. 导航仅读本机汇总，取消旧响应，读取失败不能表现为空历史。
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    void loadReviewTracking(controller.signal)
      .then((r) => {
        if (!controller.signal.aborted) setResponse(r)
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setResponse(null)
          setError(e instanceof Error ? e.message : '审核状态读取失败')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [revision])
  // 3. 使用同一响应恢复筛选、分页与详情，刷新不重复触发商店请求。
  const items = response?.items ?? []
  const visible = items.filter(
    (item) =>
      (!filters.project || item.projectId === filters.project) &&
      (!filters.application || item.applicationId === filters.application) &&
      (!filters.channel || item.channel === filters.channel) &&
      (!filters.state || item.state === filters.state) &&
      (!filters.todo || item.todo === filters.todo),
  )
  const requested = Number(params.get('reviewPage'))
  const page =
    Number.isSafeInteger(requested) && requested > 0
      ? Math.min(requested, Math.max(1, Math.ceil(visible.length / 10)))
      : 1
  function filter(patch: Partial<ReviewFilters>): void {
    const next = { ...filters, ...patch }
    updateUrlState({
      reviewProject: next.project,
      reviewApplication: next.application,
      reviewChannel: next.channel,
      reviewState: next.state,
      reviewTodo: next.todo,
      reviewPage: '',
      reviewRecord: '',
    })
  }
  const selected = params.get('reviewRecord') ?? ''
  return {
    response,
    loading,
    error,
    filters,
    visible,
    page,
    selected,
    record: items.find((item) => `${item.kind}:${item.id}` === selected),
    filter,
    select: (id: string) => updateUrlState({ reviewRecord: id }),
    paginate: (value: number) => updateUrlState({ reviewPage: value > 1 ? String(value) : '' }),
    refresh: () => setRevision((v) => v + 1),
  }
}
