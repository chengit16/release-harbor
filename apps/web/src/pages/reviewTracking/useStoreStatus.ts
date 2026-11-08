/** @description 独立商店状态页面的目录、筛选与查询状态；本地执行记录只作为可选历史，不限制官方查询。 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { updateUrlState, useUrlState } from '../../app/useUrlState.ts'
import { loadStoreStatus, queryStoreStatus } from '../../api/services/storeStatus.ts'
import type { StoreStatusTarget, StoreVersionQuery } from '@release-harbor/contracts'

/** 筛选仅影响本机绑定目录，不改变商店查询目标。 */
export interface StoreStatusFilters {
  project: string
  application: string
  channel: string
}

/** 管理目录与显式查询；卸载后取消等待，旧读取不能覆盖新查询。 */
export function useStoreStatus() {
  // 1. 目录读取与商店查询独立取消；查询开始后，旧目录响应不能覆盖新结果。
  const activeQuery = useRef<AbortController | null>(null)
  const generation = useRef(0)
  useEffect(
    () => () => {
      activeQuery.current?.abort()
    },
    [],
  )
  const [response, setResponse] = useState<Awaited<ReturnType<typeof loadStoreStatus>> | null>(null)
  const [loading, setLoading] = useState(true)
  const [querying, setQuerying] = useState('')
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const params = useUrlState()
  const filters: StoreStatusFilters = {
    project: params.get('reviewProject') ?? '',
    application: params.get('reviewApplication') ?? '',
    channel: params.get('reviewChannel') ?? '',
  }
  useEffect(() => {
    const controller = new AbortController()
    const currentGeneration = ++generation.current
    setLoading(true)
    void loadStoreStatus(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted && currentGeneration === generation.current)
          setResponse(value)
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted && currentGeneration === generation.current) {
          setResponse(null)
          setError(reason instanceof Error ? reason.message : '商店状态目录读取失败')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && currentGeneration === generation.current)
          setLoading(false)
      })
    return () => controller.abort()
  }, [revision])

  // 2. 筛选与详情从 URL 推导，导航不触发官方查询。
  const visible = useMemo(
    () =>
      (response?.targets ?? []).filter(
        (target) =>
          (!filters.project || target.projectId === filters.project) &&
          (!filters.application || target.applicationId === filters.application) &&
          (!filters.channel || target.channel === filters.channel),
      ),
    [filters.application, filters.channel, filters.project, response],
  )
  const selected = params.get('reviewTarget') ?? ''
  const target =
    visible.find((item) => item.bindingId === selected) ??
    response?.targets.find((item) => item.bindingId === selected)
  const snapshot = response?.snapshots.find((item) => item.bindingId === target?.bindingId)

  function filter(patch: Partial<StoreStatusFilters>): void {
    setError('')
    const next = { ...filters, ...patch }
    updateUrlState({
      reviewProject: next.project,
      reviewApplication: next.application,
      reviewChannel: next.channel,
      reviewTarget: '',
      followPage: '',
      storePage: '',
    })
  }

  async function query(
    item: StoreStatusTarget,
    queryTarget?: StoreVersionQuery,
    materialVersionId?: string,
  ): Promise<void> {
    // 3. 显式查询全页互斥；完成后重读缓存以保留失败前的成功版本及原时间。
    if (!item.querySupported || activeQuery.current) return
    const controller = new AbortController()
    activeQuery.current = controller
    generation.current++
    setLoading(false)
    setQuerying(item.bindingId)
    setError('')
    try {
      const value = await queryStoreStatus(
        item.projectId,
        item.applicationId,
        item.bindingId,
        controller.signal,
        queryTarget,
        materialVersionId,
      )
      if (controller.signal.aborted) return
      setResponse((current) =>
        current
          ? value.materialVersionId
            ? {
                ...current,
                materialSnapshots: [
                  value,
                  // 目录重读前先保留旧成功，避免本次失败响应造成报告短暂消失。
                  ...(value.code !== 'observed'
                    ? (current.materialSnapshots ?? []).filter(
                        (entry) =>
                          entry.bindingId === value.bindingId &&
                          entry.materialVersionId === value.materialVersionId &&
                          entry.code === 'observed',
                      )
                    : []),
                  ...(current.materialSnapshots ?? []).filter(
                    (entry) =>
                      entry.bindingId !== value.bindingId ||
                      entry.materialVersionId !== value.materialVersionId,
                  ),
                ],
              }
            : {
                ...current,
                snapshots: [
                  ...(value.query
                    ? current.snapshots
                    : current.snapshots.filter((entry) => entry.bindingId !== value.bindingId)),
                  ...(value.query ? [] : [value]),
                ],
                trackedSnapshots: value.query
                  ? [
                      ...(current.trackedSnapshots ?? []).filter((entry) => {
                        return !(
                          entry.bindingId === value.bindingId &&
                          entry.query?.kind === value.query?.kind &&
                          entry.query?.buildNumber === value.query?.buildNumber
                        )
                      }),
                      value,
                    ]
                  : current.trackedSnapshots,
              }
          : current,
      )
    } catch (reason: unknown) {
      if (!controller.signal.aborted)
        setError(reason instanceof Error ? reason.message : '商店状态查询失败')
    } finally {
      activeQuery.current = null
      if (!controller.signal.aborted) {
        setQuerying('')
        setRevision((value) => value + 1)
      }
    }
  }

  return {
    response,
    visible,
    filters,
    target,
    snapshot,
    loading,
    querying,
    error,
    filter,
    query,
    select: (bindingId: string) => {
      setError('')
      updateUrlState({ reviewTarget: bindingId })
    },
    close: () => updateUrlState({ reviewTarget: '' }),
    refresh: () => {
      if (!activeQuery.current) {
        setError('')
        setRevision((value) => value + 1)
      }
    },
  }
}
