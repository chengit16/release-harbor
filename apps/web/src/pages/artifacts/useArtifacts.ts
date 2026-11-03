/** @description 产物状态读取与有限轮询，末态不轮询，刷新或离开页面取消旧请求。 */
import { useEffect, useState } from 'react'
import type { ArtifactRecord } from '@release-harbor/contracts'
import { listArtifacts } from '../../api/services/artifacts.ts'

/** 只轮询当前应用中的未完成事实，不触发重新检查或重新上传。 */
export function useArtifacts(projectId: string, applicationId: string) {
  const [records, setRecords] = useState<ArtifactRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    setLoading(true)
    setError('')
    async function load(): Promise<void> {
      try {
        const result = await listArtifacts(projectId, applicationId, controller.signal)
        if (controller.signal.aborted) return
        setRecords(result)
        if (result.some((record) => record.status === 'receiving' || record.status === 'checking'))
          timer = setTimeout(() => void load(), 1000)
      } catch (failure) {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : '产物记录读取失败')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void load()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [projectId, applicationId, revision])
  return { records, loading, error, refresh: () => setRevision((value) => value + 1) }
}
