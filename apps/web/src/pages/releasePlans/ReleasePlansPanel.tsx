/** @description 应用发布计划页签，组合意图草稿、历史与复核；服务端是有效性与确认事实来源。 */
import { useState } from 'react'
import { Alert, Button, Card, Space, Table, Tag, Typography } from 'antd'
import {
  planInvalidationMessages,
  releaseActions,
  type Application,
  type ReleasePlanView,
} from '@release-harbor/contracts'
import { PlanForm } from './PlanForm.tsx'
import { PlanReview } from './PlanReview.tsx'
import { useReleasePlans } from './useReleasePlans.ts'

/** 已选中应用下隔离的发布意图，不涉及远端执行。 */
export interface ReleasePlansPanelProps {
  /** 完整父级身份由已加载应用提供，服务端仍重新校验。 */
  application: Application
}
/** 用单一入口冻结计划，历史分页防止重复详情挤占工作区。 */
export function ReleasePlansPanel({ application }: ReleasePlansPanelProps) {
  const data = useReleasePlans(application)
  const [selected, setSelected] = useState('')
  return (
    <section aria-label="发布计划" className="release-plans-panel">
      <Alert
        type="info"
        showIcon
        title="先冻结意图，再人工确认"
        description="计划绑定已通过的预检、明确目标与安装包。确认有效期不超过原预检期限；真实上传与回执将在下一阶段接入。"
      />
      <div className="section-title">
        <h3>本次发布意图</h3>
        <Button onClick={data.refresh} disabled={data.busy} loading={data.loading}>
          重新读取计划与预检
        </Button>
      </div>
      {data.error && (
        <Alert role="alert" type="error" showIcon title={data.error} className="form-feedback" />
      )}
      {data.notice && (
        <Alert
          role="status"
          type="success"
          showIcon
          title={data.notice}
          className="form-feedback"
        />
      )}
      <Card>
        <PlanForm
          application={application}
          preflights={data.preflights}
          disabled={data.loading || data.busy}
          onFreeze={data.freeze}
          onFrozen={(plan) => setSelected(plan.id)}
        />
      </Card>
      <section aria-label="计划历史" className="plan-history">
        <div className="section-title">
          <h3>
            计划历史 <Typography.Text type="secondary">{data.plans.length} 份</Typography.Text>
          </h3>
        </div>
        <Table<ReleasePlanView>
          rowKey={(v) => v.plan.id}
          dataSource={data.plans}
          loading={data.loading}
          pagination={{ pageSize: 5, hideOnSinglePage: true, showSizeChanger: false }}
          locale={{ emptyText: '尚未冻结发布计划' }}
          columns={[
            {
              title: '计划',
              key: 'plan',
              render: (_, v) => (
                <Space orientation="vertical" size={2}>
                  <Typography.Text>{releaseActions[v.plan.snapshot.action]}</Typography.Text>
                  <Typography.Text type="secondary">
                    {v.plan.snapshot.artifact.identity?.versionName} ·{' '}
                    {new Date(v.plan.createdAt).toLocaleString()}
                  </Typography.Text>
                </Space>
              ),
            },
            {
              title: '当前状态',
              key: 'status',
              render: (_, v) => (
                <>
                  <Tag
                    color={
                      !v.current ? 'default' : v.plan.status === 'confirmed' ? 'green' : 'blue'
                    }
                  >
                    {v.plan.status === 'cancelled'
                      ? '已取消'
                      : !v.current
                        ? '已失效'
                        : v.plan.status === 'confirmed'
                          ? '已确认'
                          : '待确认'}
                  </Tag>
                  {v.invalidatedBy && (
                    <Typography.Paragraph type="secondary" className="plan-history-reason">
                      {planInvalidationMessages[v.invalidatedBy]}
                    </Typography.Paragraph>
                  )}
                </>
              ),
            },
            {
              title: '操作',
              key: 'detail',
              width: 80,
              render: (_, v) => (
                <Button type="link" onClick={() => setSelected(v.plan.id)}>
                  复核
                </Button>
              ),
            },
          ]}
        />
      </section>
      <PlanReview
        view={data.plans.find((v) => v.plan.id === selected)}
        disabled={data.busy || data.loading}
        onClose={() => setSelected('')}
        onDecide={data.decide}
      />
    </section>
  )
}
