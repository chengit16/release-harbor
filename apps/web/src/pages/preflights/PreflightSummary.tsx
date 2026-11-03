/** @description 最新一次预检的紧凑摘要，以服务端有效性及检查项表达结果，不把通过解释为发布权限。 */
import { Alert, Badge, Button, Card, Space, Tag, Typography } from 'antd'
import { preflightMessages, type PreflightView } from '@release-harbor/contracts'
import {
  invalidationLabels,
  preflightAccount,
  preflightArtifact,
  preflightStatus,
  preflightTime,
  type PreflightContext,
} from './preflightPresentation.ts'

/** 最新结果仅接收已选定的最新记录，不自行选择较早成功。 */
interface PreflightSummaryProps {
  /** 按创建时间确定的最新事实。 */
  view: PreflightView
  /** 当前可读名称及产物标签。 */
  context: PreflightContext
  /** 打开已有记录，不重新运行或重试。 */
  onDetails: () => void
}

/** 三项检查与整体有效性分别呈现，完整诊断按需查看。 */
export function PreflightSummary({ view, context, onDetails }: PreflightSummaryProps) {
  const { record, current, invalidatedBy } = view
  const status = preflightStatus(view)
  const artifact = preflightArtifact(view, context)
  return (
    <Card
      className="preflight-latest"
      title={<h2>最新预检</h2>}
      extra={<Tag color={status.color}>{status.text}</Tag>}
    >
      <div className="preflight-result-heading">
        <div>
          <Typography.Text strong>
            {preflightAccount(view, context)} · {artifact.version}
          </Typography.Text>
          <p className="preflight-secondary">
            {preflightTime(record.createdAt)} · {artifact.fileName}
          </p>
        </div>
        <Button onClick={onDetails}>查看详情</Button>
      </div>
      <Alert
        showIcon
        type={
          current
            ? 'success'
            : record.status === 'failed'
              ? 'error'
              : record.status === 'passed'
                ? 'warning'
                : 'info'
        }
        title={
          record.status === 'passed' && !current
            ? '本次曾通过，当前已失效，请重新运行预检'
            : preflightMessages[record.code]
        }
        description={invalidatedBy ? `失效原因：${invalidationLabels[invalidatedBy]}` : undefined}
      />
      <div className="preflight-checks" aria-label="最新预检检查项">
        {[
          { label: '产物复核', passed: record.artifact === 'passed', success: '通过' },
          { label: '凭据鉴权', passed: record.authentication === 'passed', success: '通过' },
          { label: '商店目标', passed: record.target === 'passed', success: '匹配' },
        ].map((check) => (
          <div key={check.label}>
            <span>{check.label}</span>
            <Badge
              status={
                check.passed ? 'success' : record.status === 'running' ? 'processing' : 'default'
              }
              text={check.passed ? check.success : '未验证'}
            />
          </div>
        ))}
      </div>
      <Space wrap className="preflight-boundary">
        <Tag>上传权限未验证</Tag>
        <Typography.Text type="secondary">
          仅代表这次所选绑定与安装包的检查结果，不构成发布授权。
        </Typography.Text>
      </Space>
    </Card>
  )
}
