/** @description 版本观察局部状态；页面只读历史，查询按钮单次派发，卸载取消本地等待且不自动重试。 */
import { useEffect, useRef, useState } from 'react'
import type { ReleaseObservation } from '@release-harbor/contracts'
import {
  listReleaseObservations,
  queryReleaseObservation,
} from '../../api/services/releaseObservations.ts'
/** 计划 key 隔离生命周期，返回观察历史、明确查询与本机重读入口；不改变发布回执。 */
export function useReleaseObservations(projectId: string, applicationId: string, planId: string) {
  const [records, setRecords] = useState<ReleaseObservation[]>([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0)
  const abort = useRef(new AbortController()),
    querying = useRef(false)
  const p = projectId,
    a = applicationId
  useEffect(() => {
    const controller = new AbortController()
    abort.current = controller
    setLoading(true)
    setError('')
    setRecords([])
    void listReleaseObservations(p, a, planId, controller.signal)
      .then((r) => {
        if (!controller.signal.aborted) setRecords(r)
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : '状态观察读取失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [p, a, planId, revision])
  const latest = records[0],
    successful = records.find((r) => r.code === 'observed')
  const terminal = latest?.code === 'observed' && ['rejected', 'published'].includes(latest.state)
  const cooling = !!latest && Date.now() < Date.parse(latest.nextQueryAt)
  async function query(): Promise<void> {
    if (querying.current) return
    querying.current = true
    setBusy(true)
    setError('')
    try {
      const result = await queryReleaseObservation(p, a, planId, abort.current.signal)
      if (!abort.current.signal.aborted)
        setRecords((old) => [result, ...old.filter((r) => r.id !== result.id)])
    } catch (e) {
      if (!abort.current.signal.aborted)
        setError(e instanceof Error ? e.message : '查询未完成，请重读本机观察记录核对')
    } finally {
      querying.current = false
      if (!abort.current.signal.aborted) setBusy(false)
    }
  }
  return {
    records,
    loading,
    busy,
    error,
    latest,
    successful,
    terminal,
    cooling,
    query,
    refresh: () => setRevision((v) => v + 1),
  }
}
