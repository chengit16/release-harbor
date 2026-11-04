/** @description 问题与解决中心：统计、组合筛选、分页与只读详情；URL 保存定位，目录错误与空结果分别展示。 */
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd'
import {
  channelLabels,
  issueCategories,
  issueStatuses,
  type IssueRecord,
} from '@release-harbor/contracts'
import { IssueDetail, issueStatusColors } from './IssueDetail.tsx'
import { useIssues } from './useIssues.ts'
import '../../styles/issues.css'

/** 控件均使用 Ant Design，长内容收进详情；数据只来自已校验档案，不在页面维护第二份事实。 */
export function IssuesPage() {
  const data = useIssues()
  const counts = [
    { label: '匹配问题', value: data.visible.length },
    {
      label: '待处理',
      value: data.visible.filter((i) => i.status === 'open' || i.status === 'in_progress').length,
    },
    {
      label: '待验证',
      value: data.visible.filter((i) => i.status === 'pending_verification').length,
    },
    { label: '已解决', value: data.visible.filter((i) => i.status === 'resolved').length },
  ]
  return (
    <section aria-label="问题与解决" className="issues-page">
      <div className="issue-section-heading">
        <div>
          <Typography.Text type="secondary">
            知识库更新：{data.catalog?.updatedDate ?? '—'} · 统计随筛选变化
          </Typography.Text>
        </div>
        <Button onClick={data.refresh} loading={data.loading}>
          重新读取档案
        </Button>
      </div>
      {data.error && (
        <Alert
          role="alert"
          type="error"
          showIcon
          title={data.error}
          description="档案读取失败不会被显示成暂无问题。请重新读取或检查发布资源。"
        />
      )}
      <div className="issue-statistics">
        {counts.map((c) => (
          <Card key={c.label} size="small">
            <Statistic
              title={c.label}
              value={data.catalog ? c.value : '—'}
              loading={data.loading}
            />
          </Card>
        ))}
      </div>
      <Card className="issue-list-card">
        <div className="issue-filters">
          <Input.Search
            type="search"
            aria-label="搜索问题"
            placeholder="搜索现象、原因或办法，例如：超时"
            allowClear
            maxLength={200}
            value={data.filters.query}
            onChange={(event) => data.filter({ query: event.target.value }, true)}
            onSearch={(query) => data.filter({ query }, true)}
          />
          <Select
            aria-label="问题分类"
            placeholder="全部分类"
            allowClear
            value={data.filters.category || undefined}
            options={Object.entries(issueCategories).map(([value, label]) => ({ value, label }))}
            onChange={(value) => data.filter({ category: value ?? '' })}
          />
          <Select
            aria-label="关联渠道"
            placeholder="全部渠道"
            allowClear
            value={data.filters.channel || undefined}
            options={[
              { value: 'common', label: '公共' },
              ...Object.entries(channelLabels).map(([value, label]) => ({ value, label })),
            ]}
            onChange={(value) => data.filter({ channel: value ?? '' })}
          />
          <Select
            aria-label="问题状态"
            placeholder="全部状态"
            allowClear
            value={data.filters.status || undefined}
            options={Object.entries(issueStatuses).map(([value, label]) => ({ value, label }))}
            onChange={(value) => data.filter({ status: value ?? '' })}
          />
        </div>
        <div className="issue-section-heading">
          <Typography.Text type="secondary">
            {data.catalog ? `找到 ${data.visible.length} 条问题` : '等待档案读取'}
          </Typography.Text>
          <Button type="link" onClick={data.clear}>
            清空筛选
          </Button>
        </div>
        <Table<IssueRecord>
          size="middle"
          rowKey="id"
          loading={data.loading}
          dataSource={data.visible}
          pagination={{
            current: data.page,
            pageSize: 10,
            showSizeChanger: false,
            hideOnSinglePage: true,
            onChange: data.setPage,
          }}
          locale={{
            emptyText: (
              <Empty
                description={
                  data.error
                    ? '档案暂不可用'
                    : data.catalog?.items.length
                      ? '没有匹配问题，请调整筛选条件'
                      : '暂无问题档案'
                }
              />
            ),
          }}
          columns={[
            {
              title: '问题',
              key: 'title',
              render: (_, issue) => (
                <div className="issue-title-cell">
                  <Space wrap size={[4, 4]}>
                    <Typography.Text type="secondary" className="issue-number">
                      {issue.id}
                    </Typography.Text>
                    {issue.channels.map((c) => (
                      <Tag key={c}>{c === 'common' ? '公共' : channelLabels[c]}</Tag>
                    ))}
                  </Space>
                  <Button
                    type="link"
                    className="issue-title-button"
                    onClick={() => data.select(issue.id)}
                  >
                    {issue.title}
                  </Button>
                </div>
              ),
            },
            {
              title: '分类',
              dataIndex: 'category',
              width: 145,
              responsive: ['lg'],
              render: (category: IssueRecord['category']) => issueCategories[category],
            },
            {
              title: '状态',
              key: 'status',
              width: 86,
              render: (_, issue) => (
                <Tag color={issueStatusColors[issue.status]}>{issueStatuses[issue.status]}</Tag>
              ),
            },
            { title: '更新', dataIndex: 'updatedDate', width: 125, responsive: ['md'] },
            {
              title: '操作',
              key: 'action',
              responsive: ['md'],
              width: 65,
              render: (_, issue) => (
                <Button
                  type="link"
                  aria-label={`查看 ${issue.id}`}
                  onClick={() => data.select(issue.id)}
                >
                  查看
                </Button>
              ),
            },
          ]}
        />
      </Card>
      <Typography.Paragraph type="secondary" className="issue-footnote">
        档案记录已知问题与解决经验，由 AI 随开发维护。问题已解决与商店历史执行成功分别核对。
      </Typography.Paragraph>
      <IssueDetail
        issue={data.issue}
        selected={data.selected}
        loading={data.loading}
        failed={!!data.error}
        onSelect={data.select}
        onClose={() => data.select('')}
      />
    </section>
  )
}
