/** @description 安装包记录删除确认；显式调用本机维护接口，离页后忽略旧响应，不触发发布操作。 */
import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Modal, Typography } from 'antd'
import { deleteArtifactRecords } from '../../api/services/localProductivity.ts'

/** 仅传递安全定位与展示字段；按钮可用性不替代服务端状态和归属校验。 */
export interface ArtifactDeleteButtonProps {
  /** 当前明确选择的记录；最多一百条，不接受本机路径。 */
  records: { id: string; fileName: string }[]
  /** 成功或失败后刷新事实；部分文件操作失败也需核对实际列表。 */
  onChanged: () => void
  /** 其他维护操作进行中，或所选状态不符合删除条件时禁用。 */
  disabled?: boolean
  /** 批量入口可使用“删除所选记录”，默认“删除记录”。 */
  label?: string
}

/** 应用详情卡片与存储目录共用删除确认，取消不发请求，失败保留可读提示。 */
export function ArtifactDeleteButton({
  records,
  onChanged,
  disabled = false,
  label = '删除记录',
}: ArtifactDeleteButtonProps) {
  const [open, setOpen] = useState(false)
  const [targets, setTargets] = useState(records)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  async function handleDelete() {
    if (busy || disabled || !targets.length) return
    setBusy(true)
    setError('')
    try {
      await deleteArtifactRecords(targets.map((record) => record.id))
      if (!mounted.current) return
      setOpen(false)
      onChanged()
    } catch (failure) {
      if (!mounted.current) return
      setError(failure instanceof Error ? failure.message : '删除未完成，请刷新列表核对')
      // 不自动重放可能已部分完成的文件删除；关闭后由调用方重新读取服务端事实。
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  return (
    <>
      <Button
        danger
        size="small"
        disabled={disabled || !records.length}
        onClick={() => {
          setError('')
          setTargets(records)
          setOpen(true)
        }}
      >
        {label}
      </Button>
      <Modal
        title="确认删除安装包记录"
        open={open}
        okText="确认删除记录"
        cancelText={error ? '关闭并刷新' : '取消'}
        okButtonProps={{ danger: true, disabled: !!error || disabled || !records.length }}
        confirmLoading={busy}
        closable={!busy}
        maskClosable={!busy}
        keyboard={!busy}
        onOk={() => void handleDelete()}
        onCancel={() => {
          if (busy) return
          setOpen(false)
          if (error) onChanged()
        }}
      >
        <Typography.Paragraph>
          将删除以下 {targets.length}{' '}
          条失败或原文件已清理的安装包记录及其残余文件，删除后不再显示在安装包列表中。此操作不能撤销。
        </Typography.Paragraph>
        <ul style={{ maxHeight: 180, overflowY: 'auto', overflowWrap: 'anywhere' }}>
          {targets.map((record) => (
            <li key={record.id}>{record.fileName}</li>
          ))}
        </ul>
        <Alert
          type="warning"
          showIcon
          title="发布历史、回执和防重复提交保护保留"
          description="历史计划中的包身份和摘要继续保留；删除记录不会恢复旧计划或授权，再次使用需重新导入并准备。"
        />
        {error && <Alert role="alert" type="error" title={error} className="form-feedback" />}
      </Modal>
    </>
  )
}
