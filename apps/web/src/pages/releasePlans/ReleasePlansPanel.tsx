/** @description 应用发布计划页签，组合意图草稿、历史与复核；服务端是有效性与确认事实来源。 */
import { planStatus } from './releaseStatus.ts'
import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Card, Space, Table, Tag, Typography } from 'antd'
import {
  preparationMessages,
  releaseActions,
  type Application,
  type ReleasePlanView,
} from '@release-harbor/contracts'
import { AttemptHistory } from './AttemptHistory.tsx'
import { AttemptReview } from './AttemptReview.tsx'
import { PreparationForm } from './PreparationForm.tsx'
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
  const [selectedAttempt, setSelectedAttempt] = useState('')
  const attempt = data.attempts.find((a) => a.id === selectedAttempt)
  const [selected, setSelected] = useState('')
  const [activePreparation, setActivePreparation] = useState('')
  const opened = useRef('')
  const latest = data.preparations.find((p) => p.id === activePreparation) ?? data.preparations[0]
  useEffect(() => {
    if (
      latest?.id === activePreparation &&
      latest?.status === 'ready' &&
      latest.planId &&
      data.plans.some((v) => v.plan.id === latest.planId) &&
      opened.current !== latest.id
    ) {
      opened.current = latest.id
      setSelected(latest.planId)
    }
  }, [latest, activePreparation, data.plans])
  return (
    <section aria-label="发布计划" className="release-plans-panel">
      <Alert
        type="info"
        showIcon
        title="填写内容，准备后确认一次"
        description="系统自动检查账号、目标和安装包。准备完成后核对摘要并确认一次：华为保存草稿，小米与 OPPO 更新提交审核。其他渠道按顺序接入。"
      />
      <div className="section-title">
        <h3>本次发布</h3>
        <Button onClick={data.refresh} disabled={data.busy} loading={data.loading}>
          重新读取发布数据
        </Button>
      </div>
      {data.error && (
        <Alert role="alert" type="error" showIcon title={data.error} className="form-feedback" />
      )}
      {data.notice && (
        <Alert role="status" type="info" showIcon title={data.notice} className="form-feedback" />
      )}
      <Card>
        <PreparationForm
          latest={latest}
          bindings={data.bindings}
          artifacts={data.artifacts}
          disabled={data.loading || data.busy || latest?.status === 'checking'}
          onPrepare={data.prepare}
          onPrepared={setActivePreparation}
        />
      </Card>
      {latest && (
        <Alert
          role="status"
          showIcon
          type={
            latest.status === 'ready'
              ? 'success'
              : latest.status === 'checking'
                ? 'info'
                : 'warning'
          }
          title={preparationMessages[latest.code]}
          description={
            latest.status === 'ready'
              ? '摘要内容已保存，核对后确认才会上传。'
              : latest.status === 'checking'
                ? '可刷新查看原进度；系统不会重复发起检查。'
                : '请在当前页面修正账号、绑定或安装包，再重新准备。'
          }
          action={
            latest.planId ? (
              <Button onClick={() => setSelected(latest.planId ?? '')}>查看发布摘要</Button>
            ) : undefined
          }
        />
      )}
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
          locale={{ emptyText: '尚未准备发布' }}
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
              render: (_, v) => {
                const status = planStatus(
                  v,
                  data.attempts.find((a) => a.planId === v.plan.id),
                )
                return (
                  <>
                    <Tag color={status.color}>{status.label}</Tag>
                    <Typography.Paragraph type="secondary" className="plan-history-reason">
                      {status.description}
                    </Typography.Paragraph>
                  </>
                )
              },
            },
            {
              title: '操作',
              key: 'detail',
              width: 80,
              render: (_, v) => (
                <Button type="link" onClick={() => setSelected(v.plan.id)}>
                  查看
                </Button>
              ),
            },
          ]}
        />
      </section>
      <AttemptHistory attempts={data.attempts} onReview={setSelectedAttempt} />
      <AttemptReview
        attempt={attempt}
        plan={data.plans.find((v) => v.plan.id === attempt?.planId)?.plan}
        disabled={data.busy || data.loading}
        onClose={() => setSelectedAttempt('')}
        error={data.error}
        onSave={data.reconcile}
      />
      <PlanReview
        view={data.plans.find((v) => v.plan.id === selected)}
        attempt={data.attempts.find((a) => a.planId === selected)}
        onReviewAttempt={(id) => {
          setSelected('')
          setSelectedAttempt(id)
        }}
        onExecute={data.execute}
        disabled={data.busy || data.loading}
        onClose={() => setSelected('')}
        error={data.error}
        onCancel={(plan) => data.decide(plan, 'cancel')}
      />
    </section>
  )
}
