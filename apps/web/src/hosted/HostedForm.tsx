/** @description 在线目录表单弹窗；写入失败保留用户输入，成功后才关闭并刷新资源。 */
import { Alert, Form, Modal } from 'antd'
import { useState, type ReactNode } from 'react'
import { hostedWrite } from './api.ts'

/** 弹窗只负责提交当前资源的公开字段。 */
export interface HostedFormProps {
  /** 弹窗标题。 */
  title: string
  /** 已由父级按当前空间和资源组成的相对路径。 */
  path: string
  /** 新增用 POST，更新用 PATCH。 */
  method?: 'POST' | 'PATCH'
  /** 编辑时的公开初始字段。 */
  initial?: Record<string, unknown>
  /** 编辑项，随当前空间卸载。 */
  children: ReactNode
  /** 映射固定平台、渠道或待更新版本等公共约束。 */
  prepare?: (values: Record<string, unknown>) => Record<string, unknown>
  /** 用户关闭弹窗。 */
  onClose(): void
  /** 写入成功，父级负责刷新对应目录。 */
  onSaved(): void
}

/** 统一保存中的防重复、校验失败与提交错误处理。 */
export function HostedForm({
  title,
  path,
  method = 'POST',
  initial,
  children,
  prepare,
  onClose,
  onSaved,
}: HostedFormProps) {
  const [form] = Form.useForm<Record<string, unknown>>()
  const [isSaving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save(values: Record<string, unknown>) {
    if (isSaving) return
    setSaving(true)
    setError('')
    try {
      await hostedWrite(path, method, prepare?.(values) ?? values)
      onSaved()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      title={title}
      okText="保存"
      onOk={() => form.submit()}
      onCancel={onClose}
      confirmLoading={isSaving}
      closable={!isSaving}
      mask={{ closable: false }}
      keyboard={!isSaving}
      cancelButtonProps={{ disabled: isSaving }}
    >
      {error && <Alert type="error" showIcon title={error} />}
      <Form form={form} layout="vertical" initialValues={initial} onFinish={save}>
        {children}
      </Form>
    </Modal>
  )
}
