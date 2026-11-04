/** @description 问题解决过程的只读详情抽屉；纯文本展示事实，相关记录定位不改变当前筛选或触发商店动作。 */
import {
  Alert,
  Button,
  Collapse,
  Descriptions,
  Divider,
  Drawer,
  Empty,
  Space,
  Tag,
  Typography,
} from 'antd'
import {
  causeConfidences,
  channelLabels,
  issueCategories,
  issueKinds,
  issueSeverities,
  issueStatuses,
  issueVerificationMethods,
  type IssueRecord,
} from '@release-harbor/contracts'

/** 已验证目录中的记录及用户选择回调，不接收原始 HTML 或任意外部地址。 */
export interface IssueDetailProps {
  issue: IssueRecord | undefined
  selected: string
  loading: boolean
  failed: boolean
  onSelect: (id: string) => void
  onClose: () => void
}
/** 状态颜色只表达档案处理事实，不代替历史商店结果。 */
export const issueStatusColors = {
  resolved: 'success',
  open: 'warning',
  in_progress: 'processing',
  pending_verification: 'blue',
  deferred: 'default',
} as const
/** 原因确认程度与解决状态分开展示，无法定位时保留抽屉中的明确说明。 */
export function IssueDetail({
  issue,
  selected,
  loading,
  failed,
  onSelect,
  onClose,
}: IssueDetailProps) {
  return (
    <Drawer
      title="问题详情"
      open={!!selected}
      onClose={onClose}
      size="large"
      styles={{ wrapper: { maxWidth: '100vw' } }}
      extra={<Button onClick={onClose}>关闭问题详情</Button>}
    >
      {loading ? (
        <Typography.Paragraph>正在读取档案…</Typography.Paragraph>
      ) : failed ? (
        <Alert type="error" title="档案未能读取，请返回页面重新读取" />
      ) : !issue ? (
        <Empty description="未找到这条问题记录，请核对编号" />
      ) : (
        <article className="issue-detail">
          <Typography.Text type="secondary" copyable>
            {issue.id}
          </Typography.Text>
          <Typography.Title level={3}>{issue.title}</Typography.Title>
          <Space wrap>
            <Tag color={issueStatusColors[issue.status]}>{issueStatuses[issue.status]}</Tag>
            <Tag>{issueCategories[issue.category]}</Tag>
            <Tag>{issueKinds[issue.kind]}</Tag>
          </Space>
          <Descriptions
            column={1}
            size="small"
            items={[
              {
                key: 'channels',
                label: '关联渠道',
                children: issue.channels
                  .map((c) => (c === 'common' ? '公共' : channelLabels[c]))
                  .join('、'),
              },
              { key: 'severity', label: '影响程度', children: issueSeverities[issue.severity] },
              {
                key: 'observed',
                label: '首次记录',
                children: issue.firstObservedDate ?? '日期未确认',
              },
              { key: 'updated', label: '更新时间', children: issue.updatedDate },
            ]}
          />
          <section>
            <h3>发生现象</h3>
            <Typography.Paragraph>{issue.symptoms}</Typography.Paragraph>
          </section>
          <section>
            <h3>
              原因分析{' '}
              <Tag color={issue.rootCause.confidence === 'confirmed' ? 'default' : 'warning'}>
                {causeConfidences[issue.rootCause.confidence]}
              </Tag>
            </h3>
            <Typography.Paragraph>{issue.rootCause.detail}</Typography.Paragraph>
          </section>
          <section>
            <h3>解决办法</h3>
            <Typography.Paragraph>{issue.solution}</Typography.Paragraph>
          </section>
          <section>
            <h3>验证结果</h3>
            <Alert
              type={issue.verification.result === 'passed' ? 'success' : 'info'}
              showIcon
              title={issue.verification.result === 'passed' ? '已有验证依据' : '仍待验证'}
              description={issue.verification.detail}
            />
            <Space wrap>
              {issue.verification.methods.map((m) => (
                <Tag key={m}>{issueVerificationMethods[m]}</Tag>
              ))}
            </Space>
          </section>
          <section>
            <h3>避免再次发生</h3>
            <Typography.Paragraph>{issue.prevention}</Typography.Paragraph>
          </section>
          {!!issue.relatedIssues.length && (
            <section>
              <h3>关联问题</h3>
              <Space wrap>
                {issue.relatedIssues.map((id) => (
                  <Button key={id} onClick={() => onSelect(id)}>
                    {id}
                  </Button>
                ))}
              </Space>
            </section>
          )}
          <Divider />
          <Collapse
            items={[
              {
                key: 'evidence',
                label: '代码提交与验收证据',
                children: (
                  <Space orientation="vertical" className="issue-evidence">
                    {issue.evidence.documents.map((path, index) => (
                      <Typography.Link
                        key={path}
                        href={`/api/issues/${issue.id}/documents/${index}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {path}
                      </Typography.Link>
                    ))}
                    {issue.evidence.commits.map((commit) => (
                      <Typography.Text key={commit} code copyable>
                        {commit}
                      </Typography.Text>
                    ))}
                    {!issue.evidence.documents.length && !issue.evidence.commits.length && (
                      <Typography.Text type="secondary">尚未登记文档或提交证据</Typography.Text>
                    )}
                  </Space>
                ),
              },
            ]}
          />
        </article>
      )}
    </Drawer>
  )
}
