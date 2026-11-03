/** @description 当前应用的预检数据聚合，进行中轮询且仅查询事实，卸载或刷新后取消旧读取。 */
import { useEffect, useState } from 'react'
import type {
  ArtifactRecord,
  ChannelBinding,
  PreflightView,
  ProfileCatalog,
} from '@release-harbor/contracts'
import { listBindings } from '../../api/services/applications.ts'
import { listArtifacts } from '../../api/services/artifacts.ts'
import { listPreflights, listProfiles } from '../../api/services/preflights.ts'

/** 只含公开资料；目录读取失败时禁止沿用旧的提交版本。 */
export interface PreflightData {
  /** 绑定快照，每次主动刷新重新读取。 */
  bindings: ChannelBinding[]
  /** 已接收产物，表单只选择 ready 状态。 */
  artifacts: ArtifactRecord[]
  /** 凭据引用与安全目录版本。 */
  catalog: ProfileCatalog
  /** 历史事实及当前有效性。 */
  views: PreflightView[]
}

/** 查询失败保留错误，清空可提交快照；运行中轮询，末态每 30 秒重查有效期。 */
export function usePreflights(projectId: string, applicationId: string) {
  const [data, setData] = useState<PreflightData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    setLoading(true)
    setError('')
    setData(null)
    async function load(): Promise<void> {
      try {
        const [bindings, artifacts, catalog, views] = await Promise.all([
          listBindings(projectId, applicationId, controller.signal),
          listArtifacts(projectId, applicationId, controller.signal),
          listProfiles(controller.signal),
          listPreflights(projectId, applicationId, controller.signal),
        ])
        if (controller.signal.aborted) return
        setData({ bindings, artifacts, catalog, views })
        if (views.length)
          timer = setTimeout(
            () => void load(),
            views.some((v) => v.record.status === 'running') ? 1000 : 30_000,
          )
      } catch (failure) {
        if (!controller.signal.aborted) {
          setData(null)
          setError(failure instanceof Error ? failure.message : '预检记录读取失败')
        }
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
  return { data, loading, error, refresh: () => setRevision((value) => value + 1) }
}
