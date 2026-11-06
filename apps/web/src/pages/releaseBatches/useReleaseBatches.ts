/** @description 批次只读轮询与用户驱动的写入；保存稳定请求编号，刷新不重放准备和确认。 */
import { useEffect, useRef, useState } from 'react'
import type {
  Application,
  ReleaseBatch,
  BatchTargetInput,
  ReleasePlan,
  ReleaseAttempt,
  ChannelBinding,
  ArtifactRecord,
} from '@release-harbor/contracts'
import { listBindings } from '../../api/services/applications.ts'
import { listArtifacts } from '../../api/services/artifacts.ts'
import { listReleasePlans, listReleaseAttempts } from '../../api/services/releasePlans.ts'
import { listReleaseBatches, mutateReleaseBatch } from '../../api/services/releaseBatches.ts'
import { updateUrlState } from '../../app/useUrlState.ts'
/** 页面失败保留草稿并查询事实；HTTP 响应不明时仍复用原请求编号。 */
export function useReleaseBatches(application: Application) {
  const [batches, setBatches] = useState<ReleaseBatch[]>([]),
    [plans, setPlans] = useState<ReleasePlan[]>([]),
    [attempts, setAttempts] = useState<ReleaseAttempt[]>([]),
    [bindings, setBindings] = useState<ChannelBinding[]>([]),
    [artifacts, setArtifacts] = useState<ArtifactRecord[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [tick, setTick] = useState(0)
  const lock = useRef(false),
    currentIntent = useRef(new Map<string, string>()),
    controller = useRef<AbortController | null>(null),
    createKey = useRef({ digest: '', id: '' }),
    prepareKeys = useRef(new Map<string, string>()),
    confirmKeys = useRef(new Map<string, string>())
  useEffect(() => {
    const c = new AbortController()
    controller.current = c
    return () => c.abort()
  }, [application.id])
  useEffect(() => {
    const c = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    async function load() {
      try {
        const [saved, planViews, receipts, channels, packages] = await Promise.all([
          listReleaseBatches(application.projectId, application.id, c.signal),
          listReleasePlans(application.projectId, application.id, c.signal),
          listReleaseAttempts(application.projectId, application.id, c.signal),
          listBindings(application.projectId, application.id, c.signal),
          listArtifacts(application.projectId, application.id, c.signal),
        ])
        if (c.signal.aborted) return
        setBatches(saved)
        setPlans(planViews.map((v) => v.plan))
        setAttempts(receipts)
        setBindings(channels)
        setArtifacts(packages)
        setLoading(false)
        const active = saved.some((b) =>
          b.revisions.some((r) => r.preparedAt === null || (r.run && !r.run.finishedAt)),
        )
        timer = setTimeout(() => void load(), active ? 1000 : 30000)
      } catch (e) {
        if (!c.signal.aborted) {
          setError(e instanceof Error ? e.message : '批次数据无法读取')
          setLoading(false)
          timer = setTimeout(() => void load(), 5000)
        }
      }
    }
    void load()
    return () => {
      c.abort()
      clearTimeout(timer)
    }
  }, [application.id, application.projectId, tick])
  async function mutate(
    path: string,
    body: unknown,
    method = 'POST',
  ): Promise<ReleaseBatch | null> {
    if (lock.current || !controller.current) return null
    lock.current = true
    setBusy(true)
    setError('')
    try {
      const b = await mutateReleaseBatch(
        application.projectId,
        application.id,
        path,
        body,
        controller.current.signal,
        method,
      )
      setBatches((old) => [b, ...old.filter((v) => v.id !== b.id)])
      setTick((n) => n + 1)
      return b
    } catch (e) {
      if (!controller.current.signal.aborted)
        setError(e instanceof Error ? e.message : '请求未完成，请重新读取原进度')
      setTick((n) => n + 1)
      return null
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  async function create(targets: BatchTargetInput[]) {
    const digest = JSON.stringify(targets)
    if (createKey.current.digest !== digest) createKey.current = { digest, id: crypto.randomUUID() }
    const b = await mutate('', { requestId: createKey.current.id, targets })
    if (b) {
      updateUrlState({ batch: b.id })
      return b
    }
    return null
  }
  async function prepare(b: ReleaseBatch) {
    const key = b.id + ':' + b.editVersion
    const intent = JSON.stringify({ targets: b.draft })
    if (currentIntent.current.get(b.id) !== intent) {
      currentIntent.current.set(b.id, intent)
      prepareKeys.current.set(key, crypto.randomUUID())
    }
    if (!prepareKeys.current.has(key)) prepareKeys.current.set(key, crypto.randomUUID())
    return mutate('/' + b.id + '/prepare', {
      expectedRevision: b.editVersion,
      requestId: prepareKeys.current.get(key),
    })
  }
  async function confirm(b: ReleaseBatch, rid: string, digest: string) {
    if (!confirmKeys.current.has(rid)) confirmKeys.current.set(rid, crypto.randomUUID())
    return mutate(`/${b.id}/revisions/${rid}/confirm-and-start`, {
      requestId: confirmKeys.current.get(rid),
      expectedDigest: digest,
      acknowledged: true,
    })
  }
  return {
    batches,
    plans,
    attempts,
    bindings,
    artifacts,
    error,
    busy,
    loading,
    refresh: () => setTick((n) => n + 1),
    create,
    prepare,
    confirm,
    edit: (b: ReleaseBatch, targets: BatchTargetInput[]) =>
      mutate('/' + b.id, { expectedRevision: b.editVersion, targets }, 'PUT'),
    stop: (b: ReleaseBatch, runId: string) => mutate(`/${b.id}/runs/${runId}/stop`, {}),
  }
}
