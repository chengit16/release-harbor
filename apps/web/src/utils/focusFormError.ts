/** @description 表单手动校验的焦点恢复；只读取错误字段路径，不传播输入或敏感错误对象。 */
import type { FormInstance } from 'antd'

/** 定位首个无效字段；业务异常不是字段校验失败时保持原反馈。 */
export function focusFormError(form: FormInstance, error: unknown): void {
  if (!error || typeof error !== 'object' || !('errorFields' in error)) return
  if (!Array.isArray(error.errorFields)) return
  const first: unknown = error.errorFields[0]
  if (!first || typeof first !== 'object' || !('name' in first)) return
  if (
    Array.isArray(first.name) &&
    first.name.length &&
    first.name.every((part: unknown) => typeof part === 'string' || typeof part === 'number')
  )
    form.scrollToField(first.name, { focus: true, block: 'nearest' })
}
