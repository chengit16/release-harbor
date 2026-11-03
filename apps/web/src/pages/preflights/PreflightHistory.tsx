/** @description 预检历史展示，只读事实与失效原因分别呈现，不将鉴权当作上传授权。 */
import { Alert, Card, Descriptions, Empty, Space, Tag } from 'antd'
import { preflightMessages, type PreflightView } from '@release-harbor/contracts'

const invalidationLabels = {
  expired: '超过五分钟有效期',
  binding_changed: '商店绑定已变化',
  artifact_changed: '产物记录或字节已变化',
  profile_changed: '凭据目录已变化',
  profile_unavailable: '凭据档案不可用',
}

/** 历史组件接收经过运行时守卫的公开记录。 */
export interface PreflightHistoryProps {
  /** 每次读取重新计算有效性，不从页面缓存推导通过。 */
  views: PreflightView[]
}

/** 每条记录保留三项检查和上传权限边界；过期通过只作为历史事实。 */
export function PreflightHistory({ views }: PreflightHistoryProps) {
  if (!views.length) return <Empty description="尚无只读预检记录" />
  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      {views.map(({ record, current, invalidatedBy }) => (
        <Card
          key={record.id}
          size="small"
          title={record.credentialReference}
          extra={
            <Tag color={current ? 'success' : record.status === 'failed' ? 'error' : 'default'}>
              {current
                ? '当前通过'
                : record.status === 'running'
                  ? '核验中'
                  : record.status === 'passed'
                    ? '历史通过 · 已失效'
                    : record.status === 'failed'
                      ? '失败'
                      : '无法验证'}
            </Tag>
          }
        >
          <Alert
            type={current ? 'success' : record.status === 'failed' ? 'error' : 'info'}
            showIcon
            title={preflightMessages[record.code]}
          />
          {invalidatedBy && <p role="status">失效原因：{invalidationLabels[invalidatedBy]}</p>}
          <Descriptions
            size="small"
            column={1}
            style={{ marginTop: 16 }}
            items={[
              {
                key: 'artifact',
                label: '产物复核',
                children: record.artifact === 'passed' ? '通过' : '未验证',
              },
              {
                key: 'authentication',
                label: '凭据鉴权',
                children: record.authentication === 'passed' ? '通过' : '未验证',
              },
              {
                key: 'target',
                label: '商店目标',
                children: record.target === 'passed' ? '匹配' : '未验证',
              },
              { key: 'upload', label: '上传权限', children: '未验证' },
              {
                key: 'checked',
                label: '检查时间',
                children: record.checkedAt ? new Date(record.checkedAt).toLocaleString() : '进行中',
              },
              {
                key: 'expires',
                label: '有效期至',
                children: record.expiresAt ? new Date(record.expiresAt).toLocaleString() : '—',
              },
              { key: 'binding', label: '商店绑定版本', children: record.bindingRevision },
              {
                key: 'sha',
                label: '产物 SHA-256',
                children: <TypographyDigest value={record.artifactSha256} />,
              },
            ]}
          />
        </Card>
      ))}
    </Space>
  )
}

function TypographyDigest({ value }: { value: string }) {
  return <code style={{ overflowWrap: 'anywhere' }}>{value}</code>
}
