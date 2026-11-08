/** @description 发布中心查询与 URL 筛选；只读响应是事实来源，卸载或刷新取消旧请求。 */
import { useEffect, useState } from 'react'
import type { ReleaseCenterResponse } from '@release-harbor/contracts'
import { loadReleaseCenter } from '../../api/services/releaseCenter.ts'
import { matchesReleaseFocus } from './releaseFocus.ts'
import { updateUrlState, useUrlState } from '../../app/useUrlState.ts'

/** 筛选名称与 URL 字段固定，空值代表全部；未知值产生空结果，不悄悄扩大筛选范围。 */
export interface ReleaseCenterFilters {
  /** 应用、项目、版本或构建号的本机文本搜索，不发起网络请求。 */
  query: string
  project: string
  application: string
  channel: string
  kind: string
  state: string
}

/** 只读列表与刷新入口；请求失败保留明确错误，不将失败表现为空历史。 */
export function useReleaseCenter() {
  const [response, setResponse] = useState<ReleaseCenterResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const params = useUrlState()
  const filters: ReleaseCenterFilters = {
    query: (params.get('releaseQuery') ?? '').slice(0, 200),
    project: params.get('releaseProject') ?? '',
    application: params.get('releaseApplication') ?? '',
    channel: params.get('releaseChannel') ?? '',
    kind: params.get('releaseKind') ?? '',
    state: params.get('releaseState') ?? '',
  }
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    loadReleaseCenter(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setResponse(value)
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : '发布记录读取失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [revision])
  const focus = params.get('releaseFocus') ?? ''
  const filtered = (response?.items ?? []).filter(
    (item) =>
      (!filters.query.trim() ||
        `${item.applicationName} ${item.projectName} ${item.versionName ?? ''} ${item.buildNumber ?? ''}`
          .toLocaleLowerCase()
          .includes(filters.query.trim().toLocaleLowerCase())) &&
      (!filters.project || item.projectId === filters.project) &&
      (!filters.application || item.applicationId === filters.application) &&
      (!filters.channel || item.channels.some((channel) => channel === filters.channel)) &&
      (!filters.kind || item.kind === filters.kind) &&
      (!filters.state || item.state === filters.state),
  )
  const visible = filtered.filter((item) => matchesReleaseFocus(item, focus))
  function filter(patch: Partial<ReleaseCenterFilters>): void {
    const next = { ...filters, ...patch }
    updateUrlState({
      releaseQuery: next.query,
      releaseProject: next.project,
      releaseApplication: next.application,
      releaseChannel: next.channel,
      releaseKind: next.kind,
      releaseState: next.state,
      releasePage: '',
      releaseFocus: '',
    })
  }
  return {
    response,
    visible,
    filtered,
    focus,
    setFocus: (value: string) =>
      updateUrlState({ releaseFocus: value, releasePage: '', releaseState: '' }),
    loading,
    error,
    filters,
    filter,
    refresh: () => setRevision((value) => value + 1),
  }
}
