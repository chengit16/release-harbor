/** @description 账号目录的页面生命周期，刷新和离开时取消旧查询，秘密不进入此 Hook。 */
import { useEffect, useState } from 'react'
import type { CredentialAccounts } from '@release-harbor/contracts'
import { listCredentialAccounts } from '../../api/services/credentialAccounts.ts'

/** 返回安全目录、读取反馈及显式刷新，旧应用的响应不能覆盖新实例。 */
export function useCredentialAccounts() {
  const [catalog, setCatalog] = useState<CredentialAccounts | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    void listCredentialAccounts(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setCatalog(value)
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) {
          setCatalog(null)
          setError(failure instanceof Error ? failure.message : '商店账号读取失败')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [revision])
  return { catalog, loading, error, refresh: () => setRevision((value) => value + 1) }
}
