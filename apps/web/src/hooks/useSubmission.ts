/** @description 页面内写操作的生命周期，阻止连点并在卸载后忽略响应，不自动重试。 */
import { useEffect, useRef, useState } from 'react'

/** 提交状态与受控执行入口；取消请求不能撤销已经写入的数据。 */
export function useSubmission() {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])

  async function submit<T>(
    action: (signal: AbortSignal) => Promise<T>,
    onSaved: (value: T) => void,
  ): Promise<void> {
    if (controller.current && !controller.current.signal.aborted) return
    const current = new AbortController()
    controller.current = current
    setSaving(true)
    setError('')
    try {
      const result = await action(current.signal)
      if (!current.signal.aborted) onSaved(result)
    } catch (failure) {
      if (!current.signal.aborted)
        setError(failure instanceof Error ? failure.message : '保存失败，请稍后重试')
    } finally {
      if (!current.signal.aborted) setSaving(false)
      if (controller.current === current) controller.current = null
    }
  }
  return { saving, error, submit }
}
