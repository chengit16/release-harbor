/** @description 手动选择和显式上传安装包，停止等待不被描述为服务端撤销。 */
import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Space, Upload } from 'antd'
import { artifactLimits, type Application } from '@release-harbor/contracts'
import { uploadArtifact } from '../../api/services/artifacts.ts'

/** 上传作用域与记录刷新回调。 */
export interface ArtifactUploadProps {
  /** 决定可选择的格式，服务端仍独立核对。 */
  application: Application
  /** 接收完成或本地等待停止后重新读取真实状态。 */
  onRefresh: () => void
  /** 发布表单内作为次级操作，独立安装包页省略时仍为主按钮。 */
  secondary?: boolean
}

/**
 * 浏览器不计算权威摘要，不接收执行器路径，不自动上传选中文件。
 * 长函数保留原因：文件选择、手动提交与停止等待属于同一局部交互，HTTP 实现已分离。
 */
export function ArtifactUpload({ application, onRefresh, secondary = false }: ArtifactUploadProps) {
  const [file, setFile] = useState<File | null>(null)
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  const extension =
    application.platform === 'android'
      ? '.apk'
      : application.platform === 'harmony'
        ? '.app'
        : '.ipa'

  async function handleUpload(): Promise<void> {
    if (!file || controller.current) return
    const current = new AbortController()
    controller.current = current
    setSending(true)
    setError('')
    setMessage('')
    try {
      await uploadArtifact(application.projectId, application.id, file, current.signal)
      if (current.signal.aborted) return
      setFile(null)
      setMessage('文件已接收，后台检查结果见下方记录。')
      onRefresh()
    } catch (failure) {
      if (!current.signal.aborted) {
        setError(failure instanceof Error ? failure.message : '文件接收失败，请刷新记录核对')
        onRefresh()
      }
    } finally {
      if (!current.signal.aborted) setSending(false)
      if (controller.current === current) controller.current = null
    }
  }

  function handleStop(): void {
    controller.current?.abort()
    controller.current = null
    setSending(false)
    setMessage('已停止本地上传等待；接收端可能已保存文件，请刷新记录确认，不要直接重复上传。')
    onRefresh()
  }

  return (
    <section aria-label="安装包接入" className="artifact-upload">
      <Upload.Dragger
        accept={extension}
        multiple={false}
        maxCount={1}
        disabled={sending}
        fileList={file ? [{ uid: 'selected', name: file.name, size: file.size }] : []}
        beforeUpload={(selected) => {
          setMessage('')
          setError('')
          if (
            !selected.name.toLowerCase().endsWith(extension) ||
            selected.size < 1 ||
            selected.size > artifactLimits.maxFileBytes
          ) {
            setError(`请选择非空 ${extension.toUpperCase()} 文件，最大 256 MiB。`)
            return Upload.LIST_IGNORE
          }
          setFile(selected)
          return false
        }}
        onRemove={() => {
          if (sending) return false
          setFile(null)
          return true
        }}
      >
        <p className="artifact-upload-title">选择或拖入 {extension.toUpperCase()} 安装包</p>
        <p className="binding-explanation">最大 256 MiB · 仅接收已有产物 · 选择后需手动确认上传</p>
      </Upload.Dragger>
      <Space wrap className="artifact-upload-actions">
        <Button
          type={secondary ? 'default' : 'primary'}
          disabled={!file || sending}
          loading={sending}
          onClick={() => void handleUpload()}
        >
          上传并检查
        </Button>
        {sending && <Button onClick={handleStop}>停止本地等待</Button>}
        <Button disabled={sending} onClick={onRefresh}>
          刷新记录
        </Button>
      </Space>
      {sending && (
        <p role="status" className="binding-explanation">
          正在上传文件并登记，接收完成后在后台检查…
        </p>
      )}
      {message && (
        <Alert type="info" role="status" title={message} showIcon className="form-feedback" />
      )}
      {error && (
        <Alert type="error" role="alert" title={error} showIcon className="form-feedback" />
      )}
    </section>
  )
}
