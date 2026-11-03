/** @description 向导会话与保存状态，材料请求只发一次，回包不明后只查询安全操作；卸载清除能力。 */
import { useEffect, useRef, useState } from 'react'
import type { BindingChannel, CredentialOperation } from '@release-harbor/contracts'
import { getCredentialOperation } from '../../api/services/credentialAccounts.ts'
import {
  beginCredentialSetup,
  cancelCredentialSetup,
  saveCredentialSetup,
  CredentialSetupError,
  type CredentialDraft,
  type SetupSession,
} from './credentialSetupTransport.ts'

/** 仅局部页面状态；未知结果禁止再次发送材料。 */
export function useCredentialSetup(
  channel: BindingChannel,
  onSaved: (reference: string) => void,
  clearMaterials: () => void,
) {
  const session = useRef<SetupSession | null>(null)
  const controller = useRef(new AbortController())
  const [working, setWorking] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [error, setError] = useState('')
  const [operation, setOperation] = useState<CredentialOperation | null>(null)
  const submitting = useRef(false)
  const callbacks = useRef({ onSaved, clearMaterials })
  callbacks.current = { onSaved, clearMaterials }
  useEffect(() => {
    const current = new AbortController()
    controller.current = current
    return () => {
      current.abort()
      if (session.current) void cancelCredentialSetup(session.current)
      session.current = null
    }
  }, [])

  async function prepare(): Promise<boolean> {
    if (submitting.current) return false
    submitting.current = true
    setWorking(true)
    setError('')
    try {
      if (session.current) void cancelCredentialSetup(session.current)
      const next = await beginCredentialSetup(channel, controller.current.signal)
      if (controller.current.signal.aborted) return false
      session.current = next
      return true
    } catch (failure) {
      if (!controller.current.signal.aborted)
        setError(failure instanceof Error ? failure.message : '无法创建配置会话')
      return false
    } finally {
      submitting.current = false
      if (!controller.current.signal.aborted) setWorking(false)
    }
  }

  async function observe(): Promise<void> {
    const current = session.current
    if (!current) throw new Error('配置会话已关闭')
    // 查询不会重新发送材料；超时保留原操作 ID，用户可再次主动查询。
    const until = Date.now() + 60_000
    while (!controller.current.signal.aborted && Date.now() < until) {
      const result = await getCredentialOperation(current.operationId, controller.current.signal)
      if (controller.current.signal.aborted) return
      setOperation(result)
      if (result.status === 'saved') {
        callbacks.current.onSaved(result.reference)
        return
      }
      if (result.status !== 'saving')
        throw new Error('本次保存需要核对，请在商店账号中查看状态；请勿重复录入')
      await new Promise<void>((resolve) => setTimeout(resolve, 700))
    }
    if (!controller.current.signal.aborted)
      throw new Error('保存仍未确认，可查询本次结果；关闭页面不会撤销已经开始的保存')
  }

  async function run(draft?: CredentialDraft): Promise<void> {
    if (submitting.current || !session.current) return
    submitting.current = true
    setWorking(true)
    setError('')
    try {
      // 1. 点击保存立即进入待核对范围，防止超时误触发第二次材料提交。
      if (draft) {
        setAttempted(true)
        let retainForCorrection = false
        try {
          const accepted = await saveCredentialSetup(
            session.current,
            draft,
            controller.current.signal,
          )
          if (controller.current.signal.aborted) return
          setOperation(accepted)
        } catch (failure) {
          if (failure instanceof CredentialSetupError && failure.retryInput) {
            retainForCorrection = true
            if (!controller.current.signal.aborted) setAttempted(false)
          }
          throw failure
        } finally {
          if (!retainForCorrection) callbacks.current.clearMaterials()
        }
      }
      // 2. 完成只以安全操作末态为准，回包丢失后仍由同一次操作核对。
      await observe()
    } catch (failure) {
      if (!controller.current.signal.aborted)
        setError(failure instanceof Error ? failure.message : '配置结果暂时无法确认')
    } finally {
      submitting.current = false
      if (!controller.current.signal.aborted) setWorking(false)
    }
  }
  return {
    working,
    attempted,
    error,
    operation,
    prepare,
    save: (draft: CredentialDraft) => run(draft),
    query: () => run(),
  }
}
