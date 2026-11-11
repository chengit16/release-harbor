/** @description 读取本机安装包身份与摘要，提供失败记录删除；不将检查通过解释为发布授权。 */
import { useState } from 'react'
import { Collapse, Alert, Button, Card, Descriptions, Empty, Spin, Tag, Typography } from 'antd'
import {
  artifactFailureMessages,
  type Application,
  type ArtifactRecord,
} from '@release-harbor/contracts'
import { StoragePanel } from '../localSettings/StoragePanel.tsx'
import { ArtifactUpload } from './ArtifactUpload.tsx'
import { ArtifactDeleteButton } from './ArtifactDeleteButton.tsx'
import { useArtifacts } from './useArtifacts.ts'

/** 当前应用的产物面板，切换应用时销毁旧草稿与轮询。 */
export interface ArtifactsPanelProps {
  /** 服务端已核对过归属的应用，不能由产物记录反推访问权限。 */
  application: Application
}

const labels = { receiving: '接收中', checking: '检查中', ready: '身份检查通过', failed: '失败' }
function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`
}
function ArtifactItem({ record, onChanged }: { record: ArtifactRecord; onChanged: () => void }) {
  return (
    <Card
      size="small"
      title={<span className="artifact-file-name">{record.fileName}</span>}
      extra={
        <Tag
          color={
            record.status === 'ready'
              ? 'success'
              : record.status === 'failed'
                ? 'error'
                : 'processing'
          }
        >
          {record.failureCode === 'removed' ? '原文件已清理' : labels[record.status]}
        </Tag>
      }
    >
      {record.failureCode && (
        <Alert
          type="error"
          title={artifactFailureMessages[record.failureCode]}
          showIcon
          className="form-feedback"
        />
      )}
      <Descriptions
        size="small"
        column={1}
        items={[
          {
            key: 'size',
            label: record.sizeBytes ? '文件大小' : '声明大小',
            children: sizeLabel(record.sizeBytes || record.expectedSizeBytes),
          },
          {
            key: 'time',
            label: '更新时间',
            children: new Date(record.updatedAt).toLocaleString('zh-CN'),
          },
          ...(record.identity
            ? [
                {
                  key: 'identity',
                  label: '真实包身份',
                  children: <Typography.Text code>{record.identity.packageName}</Typography.Text>,
                },
                {
                  key: 'version',
                  label: '版本／构建号',
                  children: `${record.identity.versionName} / ${record.identity.buildNumber}`,
                },
              ]
            : []),
          ...(record.sha256
            ? [
                {
                  key: 'digest',
                  label: 'SHA-256',
                  children: <code className="artifact-digest">{record.sha256}</code>,
                },
              ]
            : []),
        ]}
      />
      {record.status === 'failed' && (
        <ArtifactDeleteButton records={[record]} onChanged={onChanged} />
      )}
    </Card>
  )
}

/** 末态不自动重试；检查通过只证明接收字节与应用身份一致。 */
export function ArtifactsPanel({ application }: ArtifactsPanelProps) {
  const { records, loading, error, refresh } = useArtifacts(application.projectId, application.id)
  const [storageRevision, setStorageRevision] = useState(0)
  function handleRecordChanged() {
    refresh()
    setStorageRevision((value) => value + 1)
  }
  return (
    <section aria-label="安装包记录">
      <Alert
        type="info"
        title="本机接收与身份检查"
        description="检查格式、包身份、版本和 SHA-256；不验证签名或商店资格，也不会发起商店上传。"
        showIcon
        className="form-feedback"
      />
      <ArtifactUpload application={application} onRefresh={refresh} />
      {loading && (
        <div role="status" className="artifact-loading">
          <Spin size="small" />
          正在读取记录…
        </div>
      )}
      {error && (
        <Alert
          role="alert"
          type="error"
          title={error}
          action={<Button onClick={refresh}>重新读取记录</Button>}
          showIcon
          className="form-feedback"
        />
      )}
      {!loading && !error && records.length === 0 && (
        <Empty description="尚无安装包记录，先选择文件再上传检查。" />
      )}
      <Collapse
        items={[
          {
            key: 'storage',
            label: '安装包下载与清理',
            children: (
              <StoragePanel
                key={storageRevision}
                applicationId={application.id}
                onChanged={refresh}
              />
            ),
          },
        ]}
      />
      <div className="artifact-records">
        {records.map((record) => (
          <ArtifactItem key={record.id} record={record} onChanged={handleRecordChanged} />
        ))}
      </div>
    </section>
  )
}
