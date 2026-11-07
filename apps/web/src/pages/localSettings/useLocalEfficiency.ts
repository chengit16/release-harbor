/** @description 本机设置只读订阅；轮询只读取缓存，卸载取消请求，旧响应不覆盖新状态。 */
import { useEffect, useRef, useState, useCallback } from 'react'
import type { LocalEfficiencyView } from '@release-harbor/contracts'
import { readLocalEfficiency } from '../../api/services/localEfficiency.ts'
/** 页面与通知入口各自只读刷新，不开启任何后台任务。 */
export function useLocalEfficiency() {
  const [data, setData] = useState<LocalEfficiencyView>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const active = useRef(true),
    generation = useRef(0),
    abort = useRef<AbortController | undefined>(undefined)
  const refresh = useCallback(async () => {
    const version = ++generation.current
    abort.current?.abort()
    abort.current = new AbortController()
    try {
      const value = await readLocalEfficiency(abort.current.signal)
      if (active.current && version === generation.current) {
        setData(value)
        setError('')
      }
    } catch (e) {
      if (active.current && version === generation.current && !abort.current.signal.aborted)
        setError(e instanceof Error ? e.message : '本机设置读取失败')
    } finally {
      if (active.current && version === generation.current) setLoading(false)
    }
  }, [])
  useEffect(() => {
    active.current = true
    void refresh()
    const timer = setInterval(() => void refresh(), 30000)
    return () => {
      active.current = false
      abort.current?.abort()
      clearInterval(timer)
    }
  }, [refresh])
  return { data, error, loading, refresh }
}
