/** @description 应用发布计划页签，组合意图草稿、历史与复核；服务端是有效性与确认事实来源。 */
import { useState } from 'react'
import { Alert, Button, Card, Space, Table, Tag, Typography } from 'antd'
import {
  attemptMessages,
  planInvalidationMessages,
  releaseActions,
  type Application,
  type ReleasePlanView,
} from '@release-harbor/contracts'
import { PlanForm } from './PlanForm.tsx'
import { PlanReview } from './PlanReview.tsx'
import { useReleasePlans } from './useReleasePlans.ts'

/** 已选中应用下隔离的发布意图，执行只经用户明确触发。 */
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
        description="计划绑定已通过的预检、明确目标与安装包。确认有效期不超过原预检期限；华为草稿需复核后显式执行；Apple 构建上传适配待完善。"
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
                    {data.attempts.some((a) => a.planId === v.plan.id)
                      ? '授权已消费'
                      : v.plan.status === 'cancelled'
                        ? '已取消'
                        : !v.current
                          ? '已失效'
                          : v.plan.status === 'confirmed'
                            ? '已确认'
                            : '待确认'}
                  </Tag>
                  {v.invalidatedBy && !data.attempts.some((a) => a.planId === v.plan.id) && (
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
      <section aria-label="执行记录" className="plan-history">
        <h3>执行记录</h3>
        <Table
          rowKey="id"
          dataSource={data.attempts}
          pagination={{ pageSize: 5, hideOnSinglePage: true, showSizeChanger: false }}
          locale={{ emptyText: '尚无执行记录' }}
          columns={[
            {
              title: '结果',
              key: 'result',
              width: 240,
              render: (_, a) => (
                <Space orientation="vertical">
                  <Tag
                    color={
                      a.status === 'succeeded'
                        ? 'green'
                        : a.status === 'needs_reconciliation'
                          ? 'orange'
                          : 'default'
                    }
                  >
                    {a.status === 'succeeded'
                      ? '草稿已保存'
                      : a.status === 'needs_reconciliation'
                        ? '待核对'
                        : a.finishedAt
                          ? '执行已结束'
                          : '执行中'}
                  </Tag>
                  <Typography.Paragraph className="attempt-message">
                    {attemptMessages[a.code]}
                  </Typography.Paragraph>
                  <Typography.Text type="secondary">
                    {new Date(a.createdAt).toLocaleString()}
                  </Typography.Text>
                </Space>
              ),
            },
            {
              title: '核对依据',
              key: 'identity',
              render: (_, a) => (
                <Space orientation="vertical">
                  <Typography.Text copyable>{a.id}</Typography.Text>
                  <Typography.Text type="secondary">计划 {a.planId}</Typography.Text>
                  <Typography.Text type="secondary">
                    {a.remoteStartedAt ? '已授予远端写入许可' : '尚未授予远端写入许可'}
                  </Typography.Text>
                </Space>
              ),
            },
          ]}
          scroll={{ x: 520 }}
        />
      </section>
      <PlanReview
        view={data.plans.find((v) => v.plan.id === selected)}
        attempt={data.attempts.find((a) => a.planId === selected)}
        onExecute={data.execute}
        disabled={data.busy || data.loading}
        onClose={() => setSelected('')}
        onDecide={data.decide}
      />
    </section>
  )
}
