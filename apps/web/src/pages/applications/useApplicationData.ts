/** @description 应用与绑定列表的异步生命周期，切换归属即取消旧请求，不缓存跨项目数据。 */
import { useCallback, useEffect, useState } from 'react'
import type { Application, ChannelBinding } from '@release-harbor/contracts'
import { listApplications, listBindings } from '../../api/services/applications.ts'

function useCollection<T>(load: (signal: AbortSignal) => Promise<T[]>) {
  const [items, setItems] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    load(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setItems(value)
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : '数据读取失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [load, revision])
  return { items, loading, error, refresh: () => setRevision((value) => value + 1) }
}

/** 父组件以项目 ID 为 key 重建，保证未保存草稿不跨项目复用。 */
export function useApplications(projectId: string) {
  const load = useCallback(
    (signal: AbortSignal): Promise<Application[]> => listApplications(projectId, signal),
    [projectId],
  )
  return useCollection(load)
}

/** 刷新保留表单草稿；版本核对由编辑表单显式完成。 */
export function useBindings(projectId: string, applicationId: string) {
  const load = useCallback(
    (signal: AbortSignal): Promise<ChannelBinding[]> =>
      listBindings(projectId, applicationId, signal),
    [projectId, applicationId],
  )
  return useCollection(load)
}
