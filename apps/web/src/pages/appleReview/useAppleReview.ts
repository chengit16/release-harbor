/** @description Apple 页签请求与只读历史轮询；远端查询只由按钮触发，卸载终止本地等待。 */
import { useEffect, useRef, useState } from 'react'
import type {
  Application,
  AppleReviewCatalog,
  AppleReviewRecord,
  ChannelBinding,
} from '@release-harbor/contracts'
import { appleReviewApi } from '../../api/services/appleReview.ts'
import { listBindings } from '../../api/services/applications.ts'

/** 页面状态及显式动作；query 才会请求 Apple，execute 必须由摘要明确同意。 */
export interface AppleReviewModel {
  records: AppleReviewRecord[]
  bindings: ChannelBinding[]
  catalog: AppleReviewCatalog | undefined
  busy: boolean
  error: string
  clearCatalog: () => void
  query: (bindingId: string) => Promise<AppleReviewCatalog | null>
  prepare: (body: unknown) => Promise<AppleReviewRecord | null>
  execute: (record: AppleReviewRecord) => Promise<AppleReviewRecord | null>
  reconcile: (record: AppleReviewRecord, body: unknown) => Promise<AppleReviewRecord | null>
}
/** 当前应用独占生命周期；轮询不会请求 Apple 或重新执行写操作。 */
export function useAppleReview(application: Application): AppleReviewModel {
  const [records, setRecords] = useState<AppleReviewRecord[]>([]),
    [bindings, setBindings] = useState<ChannelBinding[]>([]),
    [catalog, setCatalog] = useState<AppleReviewCatalog>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const controller = useRef(new AbortController()),
    mutation = useRef(false)
  const api = appleReviewApi(application.projectId, application.id)
  useEffect(() => {
    const abort = new AbortController()
    controller.current = abort
    async function refresh(): Promise<void> {
      try {
        const [r, b] = await Promise.all([
          api.list(abort.signal),
          listBindings(application.projectId, application.id, abort.signal),
        ])
        if (!abort.signal.aborted) {
          setRecords(r)
          setBindings(b.filter((v) => v.channel === 'app_store'))
        }
      } catch (e) {
        if (!abort.signal.aborted) setError(e instanceof Error ? e.message : '读取失败')
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 2000)
    return () => {
      abort.abort()
      clearInterval(timer)
    }
  }, [application.id, application.projectId])
  async function run<T>(operation: () => Promise<T>): Promise<T | null> {
    if (mutation.current) return null
    mutation.current = true
    setBusy(true)
    setError('')
    try {
      return await operation()
    } catch (e) {
      if (!controller.current.signal.aborted)
        setError(e instanceof Error ? e.message : '操作未完成，请读取历史核对')
      return null
    } finally {
      mutation.current = false
      if (!controller.current.signal.aborted) setBusy(false)
    }
  }
  return {
    records,
    bindings,
    catalog,
    busy,
    error,
    clearCatalog: () => setCatalog(undefined),
    query: (bindingId: string) =>
      run(async () => {
        const c = await api.catalog(bindingId, controller.current.signal)
        if (!controller.current.signal.aborted) setCatalog(c)
        return c
      }),
    prepare: (body: unknown) => run(() => api.prepare(body, controller.current.signal)),
    execute: (r: AppleReviewRecord) =>
      run(async () => {
        const v = await api.execute(r, controller.current.signal)
        if (!controller.current.signal.aborted)
          setRecords(await api.list(controller.current.signal))
        return v
      }),
    reconcile: (r: AppleReviewRecord, body: unknown) =>
      run(async () => {
        const v = await api.reconcile(r, body, controller.current.signal)
        if (!controller.current.signal.aborted)
          setRecords(await api.list(controller.current.signal))
        return v
      }),
  }
}
