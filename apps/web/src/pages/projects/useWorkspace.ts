/** @description 项目列表与服务连接状态，刷新或卸载取消旧读取，写入后重新获取事实。 */
import { useEffect, useState } from 'react'
import type { Project, ProductStatus } from '@release-harbor/contracts'
import { loadWorkspace } from '../../api/services/projects.ts'

/** 工作空间读取状态，服务失联时关闭依赖连接的写入口。 */
export function useWorkspace() {
  const [projects, setProjects] = useState<Project[]>([])
  const [status, setStatus] = useState<ProductStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    loadWorkspace(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setProjects(value.projects)
          setStatus(value.status)
        }
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) {
          setStatus(null)
          setError(failure instanceof Error ? failure.message : '项目读取失败')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [revision])
  return { projects, status, loading, error, refresh: () => setRevision((value) => value + 1) }
}
