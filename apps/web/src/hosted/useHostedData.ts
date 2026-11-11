/** @description 在线目录查询状态；资源地址变化时丢弃旧空间数据，刷新不触发写入。 */
import { useEffect, useState } from 'react'
import { hostedRead } from './api.ts'

/** 只读资源当前状态；刷新后重新读取同一个公开资源。 */
export interface HostedData<T> {
  /** 首次读取或当前资源重新读取中。 */
  loading: boolean
  /** 仅属于当前资源路径的响应。 */
  data?: T
  /** 请求失败原因，保留 HTTP 状态供页面提示登录或权限变化。 */
  error?: Error
  /** 丢弃当前结果并读取最新记录。 */
  refresh(): void
}

/** 取消旧请求并比较资源地址和读取序号，避免旧租户数据短暂显示。 */
export function useHostedData<T>(path: string, decode: (value: unknown) => T): HostedData<T> {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<{ key: string; data?: T; error?: Error }>()
  const key = `${revision}:${path}`
  useEffect(() => {
    const controller = new AbortController()
    void hostedRead(path, decode, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ key, data })
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setState({ key, error: error instanceof Error ? error : new Error('读取失败') })
      },
    )
    return () => controller.abort()
  }, [decode, key, path])

  const current = state?.key === key ? state : undefined
  return {
    loading: !current,
    data: current?.data,
    error: current?.error,
    refresh: () => setRevision((value) => value + 1),
  }
}
