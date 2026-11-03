/** @description 单条预检详情 Drawer，完整保留公开诊断事实，展开不发起商店请求或读取秘密。 */
import { Alert, Descriptions, Drawer, Tag, Typography } from 'antd'
import { preflightMessages, type PreflightView } from '@release-harbor/contracts'
import { useCompactLayout } from '../../app/useCompactLayout.ts'
import {
  invalidationLabels,
  preflightAccount,
  preflightArtifact,
  preflightStatus,
  preflightTime,
  type PreflightContext,
} from './preflightPresentation.ts'

/** 详情随当前目录更新有效性，关闭仅改变本地展示状态。 */
interface PreflightDetailsProps {
  /** 未选中或记录已经不可读取时关闭。 */
  view: PreflightView | undefined
  /** 只含公开目录标签。 */
  context: PreflightContext
  /** 清除当前选中 ID。 */
  onClose: () => void
}

/** 长摘要只出现在显式打开的详情中，窄屏也保持可读和可关闭。 */
export function PreflightDetails({ view, context, onClose }: PreflightDetailsProps) {
  const compact = useCompactLayout()
  const record = view?.record
  const artifact = view ? preflightArtifact(view, context) : undefined
  return (
    <Drawer
      open={Boolean(view)}
      title="预检记录详情"
      onClose={onClose}
      closable={{ 'aria-label': '关闭预检详情' }}
      destroyOnHidden
      size={compact ? '100%' : 640}
    >
      {view && record && (
        <>
          <div className="preflight-detail-status">
            <Tag color={preflightStatus(view).color}>{preflightStatus(view).text}</Tag>
          </div>
          <Alert
            showIcon
            type={view.current ? 'success' : record.status === 'failed' ? 'error' : 'info'}
            title={preflightMessages[record.code]}
          />
          {view.invalidatedBy && (
            <Alert
              className="preflight-detail-invalidation"
              showIcon
              type="warning"
              title={`失效原因：${invalidationLabels[view.invalidatedBy]}`}
            />
          )}
          <Descriptions
            bordered
            size="small"
            column={1}
            className="preflight-diagnostics"
            items={[
              { key: 'name', label: '当前账号名称', children: preflightAccount(view, context) },
              { key: 'file', label: '安装包', children: artifact?.fileName },
              { key: 'version', label: '版本', children: artifact?.version },
              {
                key: 'artifact',
                label: '产物复核',
                children: record.artifact === 'passed' ? '通过' : '未验证',
              },
              {
                key: 'auth',
                label: '凭据鉴权',
                children: record.authentication === 'passed' ? '通过' : '未验证',
              },
              {
                key: 'target',
                label: '商店目标',
                children: record.target === 'passed' ? '匹配' : '未验证',
              },
              { key: 'upload', label: '上传权限', children: '未验证' },
              { key: 'created', label: '发起时间', children: preflightTime(record.createdAt) },
              {
                key: 'checked',
                label: '检查时间',
                children: record.checkedAt ? preflightTime(record.checkedAt) : '进行中',
              },
              {
                key: 'expires',
                label: '有效期至',
                children: record.expiresAt ? preflightTime(record.expiresAt) : '—',
              },
              { key: 'binding', label: '商店绑定版本', children: record.bindingRevision },
              {
                key: 'reference',
                label: '凭据引用',
                children: (
                  <Typography.Text className="preflight-digest" code>
                    {record.credentialReference}
                  </Typography.Text>
                ),
              },
              {
                key: 'sha',
                label: '产物 SHA-256',
                children: (
                  <Typography.Text className="preflight-digest" code>
                    {record.artifactSha256}
                  </Typography.Text>
                ),
              },
              {
                key: 'id',
                label: '检查记录 ID',
                children: (
                  <Typography.Text className="preflight-digest" code>
                    {record.id}
                  </Typography.Text>
                ),
              },
              {
                key: 'artifactId',
                label: '安装包记录 ID',
                children: (
                  <Typography.Text className="preflight-digest" code>
                    {record.artifactId}
                  </Typography.Text>
                ),
              },
            ]}
          />
        </>
      )}
    </Drawer>
  )
}
