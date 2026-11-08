/** @description 备份列表与显式删除；自动保留七份，手动副本由用户选择清理。 */
import { useState } from 'react'
import { Alert, Button, Checkbox, Flex, List, Modal, Typography } from 'antd'
import type { LocalBackup } from '@release-harbor/contracts'
import { deleteLocalBackups } from '../../api/services/localProductivity.ts'
import { storageSize } from './StoragePanel.tsx'
/** 下载由父级统一反馈，清理仅修改备份目录。 */
export function BackupRecords({
  backups,
  disabled,
  onDownload,
  onRefresh,
}: {
  /** 安全备份摘要。 */ backups: LocalBackup[]
  /** 父级维护操作时禁止并行。 */ disabled: boolean
  /** 显式下载指定备份。 */ onDownload: (id: string) => void
  /** 删除后重新读取实际列表。 */ onRefresh: () => void
}) {
  const [selected, setSelected] = useState<string[]>([]),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  async function remove() {
    setBusy(true)
    setError('')
    try {
      await deleteLocalBackups(selected)
      setSelected([])
      setOpen(false)
      onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除未完成，请刷新核对')
      setOpen(false)
      onRefresh()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Flex vertical gap={12}>
      {error && <Alert role="alert" type="error" title={error} />}
      <Flex wrap gap={12}>
        <Typography.Text>
          共 {backups.length} 份 · {storageSize(backups.reduce((n, b) => n + b.sizeBytes, 0))}
        </Typography.Text>
        <Button
          danger
          disabled={disabled || busy || !selected.length}
          onClick={() => setOpen(true)}
        >
          删除所选备份
        </Button>
      </Flex>
      <List
        locale={{ emptyText: '尚无备份，建议先创建一份' }}
        pagination={{ pageSize: 7 }}
        dataSource={backups}
        renderItem={(b) => (
          <List.Item>
            <Flex wrap justify="space-between" gap={12} style={{ width: '100%' }}>
              <div>
                <Checkbox
                  aria-label={`选择备份 ${b.id}`}
                  disabled={disabled || busy}
                  checked={selected.includes(b.id)}
                  onChange={(e) =>
                    setSelected((old) =>
                      e.target.checked
                        ? [...old, b.id].slice(0, 100)
                        : old.filter((id) => id !== b.id),
                    )
                  }
                >
                  {b.automatic ? '自动备份' : '手动备份'}
                </Checkbox>
                <div>
                  {new Date(b.createdAt).toLocaleString()} · {b.files} 个数据文件 ·{' '}
                  {(b.sizeBytes / 1024).toFixed(1)} KiB
                </div>
              </div>
              <Button disabled={disabled || busy} onClick={() => onDownload(b.id)}>
                下载备份
              </Button>
            </Flex>
          </List.Item>
        )}
      />
      <Modal
        title="确认删除备份"
        open={open}
        okText="确认删除备份"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        confirmLoading={busy}
        onCancel={() => {
          if (!busy) setOpen(false)
        }}
        onOk={() => void remove()}
      >
        <Typography.Paragraph>
          将删除 {selected.length}{' '}
          份本机备份。此操作不能撤销，不影响当前业务记录或已经下载到其他位置的副本。请确认需要的副本已经另行保存。
        </Typography.Paragraph>
      </Modal>
    </Flex>
  )
}
