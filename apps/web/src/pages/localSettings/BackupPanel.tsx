/** @description 页面内备份与恢复；文件只临时持有，预览后明确确认覆盖，不提供任意本机路径输入。 */
import { BackupRecords } from './BackupRecords.tsx'
import { RecoveryProtections } from './RecoveryProtections.tsx'
import { useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Collapse,
  Descriptions,
  Flex,
  Modal,
  Switch,
  Typography,
  Upload,
} from 'antd'
import type { LocalEfficiencyView, RestorePreview } from '@release-harbor/contracts'
import {
  createLocalBackup,
  downloadLocalBackup,
  previewLocalRestore,
  confirmLocalRestore,
  saveLocalSettings,
} from '../../api/services/localEfficiency.ts'

/** 手动与自动备份共用维护门禁，错误保留页面及用户选择。 */
export function BackupPanel({
  data,
  onRefresh,
}: {
  /** 当前设置摘要。 */ data: LocalEfficiencyView
  /** 操作完成后重读。 */ onRefresh: () => void
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [result, setResult] = useState(''),
    [preview, setPreview] = useState<RestorePreview>()
  async function act(action: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await action()
      onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作未完成')
    } finally {
      setBusy(false)
    }
  }
  async function download(id: string) {
    const raw = await downloadLocalBackup(id)
    const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `release-harbor-${id}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <Flex vertical gap={16}>
      <Alert
        type="info"
        showIcon
        title="备份业务记录，账号秘密和安装包原文件需单独保管"
        description="包含应用配置、发布历史及查询记录。备份未加密，请妥善保存；建议定期下载到其他磁盘。同盘副本不能防磁盘损坏。"
      />
      {error && <Alert role="alert" type="error" showIcon title={error} />}
      {result && <Alert role="status" type="success" showIcon title={result} />}
      {data.recoveryReadOnly && (
        <Alert
          type="warning"
          showIcon
          title="跨安装恢复处于只读保护"
          description="历史可查看，发布资格不随备份转移。请保留原记录并完成独立迁移核对。"
        />
      )}
      <Card title="备份设置">
        <Flex vertical gap={16}>
          <Flex wrap gap={12} align="center">
            <Switch
              aria-label="每日自动备份"
              checked={data.state.autoBackup}
              disabled={busy}
              onChange={(checked) =>
                void act(() =>
                  saveLocalSettings({
                    autoBackup: checked,
                    browserNotifications: data.state.browserNotifications,
                    showApplicationName: data.state.showApplicationName,
                  }),
                )
              }
            />
            <Typography.Text>每日自动备份，保留最近七份</Typography.Text>
          </Flex>
          <Typography.Text type="secondary">
            本机服务运行时执行；休眠或退出期间不运行，恢复后最多补一次。手动备份不会被自动清理。
          </Typography.Text>
          <Typography.Text>
            最近备份：
            {data.state.lastBackupAt
              ? new Date(data.state.lastBackupAt).toLocaleString()
              : '尚未创建'}
          </Typography.Text>
          {data.state.backupError && <Alert type="error" title={data.state.backupError} />}
          <Flex wrap gap={12}>
            <Button
              type="primary"
              loading={busy}
              onClick={() =>
                void act(async () => {
                  await createLocalBackup()
                  setResult('备份已创建，可在下方下载')
                })
              }
            >
              创建备份
            </Button>
          </Flex>
        </Flex>
      </Card>
      <Card title="备份记录">
        <BackupRecords
          backups={data.backups}
          disabled={busy}
          onRefresh={onRefresh}
          onDownload={(id) => void act(() => download(id))}
        />
      </Card>
      <Card title="恢复业务数据" className="settings-danger">
        <Typography.Paragraph>
          恢复将覆盖当前业务记录。先导入预览，再明确确认；账号秘密与安装包原文件需单独保管。
        </Typography.Paragraph>
        <Upload
          accept=".json"
          showUploadList={false}
          disabled={busy}
          beforeUpload={(file) => {
            if (file.size > 32 * 1024 * 1024) {
              setError('备份文件不能超过 32 MiB')
              return false
            }
            void act(async () => setPreview(await previewLocalRestore(await file.text())))
            return false
          }}
        >
          <Button disabled={busy}>导入备份并预览</Button>
        </Upload>
      </Card>
      <Collapse
        items={[
          {
            key: 'protections',
            label: '恢复与版本保护详情（高级）',
            children: <RecoveryProtections />,
          },
        ]}
      />
      <Modal
        title="确认恢复业务数据"
        open={!!preview}
        confirmLoading={busy}
        okText="确认覆盖并恢复"
        okButtonProps={{ danger: true }}
        cancelText="取消"
        onCancel={() => {
          if (!busy) setPreview(undefined)
        }}
        onOk={() => {
          if (preview)
            void act(async () => {
              await confirmLocalRestore(preview)
              setPreview(undefined)
              setResult('恢复已提交，服务正在重建，请稍后刷新页面')
            })
        }}
      >
        <Alert
          type="warning"
          showIcon
          title="将替换当前业务数据，恢复前自动保留一份当前快照"
          description="旧计划不可继续执行；跟踪暂停、旧通知不补发。账号秘密与安装包原文件不在备份中，缺失时需重新配置或导入。"
        />
        {preview && (
          <Descriptions
            column={1}
            items={[
              {
                key: 'time',
                label: '备份时间',
                children: new Date(preview.sourceCreatedAt).toLocaleString(),
              },
              {
                key: 'counts',
                label: '数据文件',
                children: `当前 ${preview.currentFiles} → 恢复 ${preview.restoredFiles}`,
              },
              {
                key: 'materials',
                label: '需核对的材料',
                children: `${preview.credentialAccounts} 个账号目录项（无秘密）、${preview.artifactRecords} 个安装包元数据（无原文件）`,
              },
              {
                key: 'origin',
                label: '安装来源',
                children: preview.sameInstallation ? '当前安装' : '其他安装：恢复后仅可查看历史',
              },
            ]}
          />
        )}
      </Modal>
    </Flex>
  )
}
