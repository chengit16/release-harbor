/** @description 发布中心中的应用发布工作区，组合意图草稿、历史与复核；服务端是有效性与确认事实来源。 */
import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Card, Collapse, Flex, Segmented, Space, Table, Tag, Typography } from 'antd'
import {
  preparationMessages,
  releaseActions,
  type Application,
  type ReleasePlanView,
} from '@release-harbor/contracts'
import { PageHelp } from '../../components/PageHelp.tsx'
import { ReleaseArtifactIntake } from '../releaseCenter/ReleaseArtifactIntake.tsx'
import { ReleaseBatchesPanel } from '../releaseBatches/ReleaseBatchesPanel.tsx'
import { useUrlState, updateUrlState } from '../../app/useUrlState.ts'
import { planStatus } from './releaseStatus.ts'
import { AttemptHistory } from './AttemptHistory.tsx'
import { AttemptReview } from './AttemptReview.tsx'
import { PreparationForm } from './PreparationForm.tsx'
import { PlanReview } from './PlanReview.tsx'
import { useReleasePlans } from './useReleasePlans.ts'

/** 已选中应用下隔离的发布意图，执行只经用户明确触发。 */
export interface ReleasePlansPanelProps {
  /** 完整父级身份由已加载应用提供，服务端仍重新校验。 */
  application: Application
  /** 新发布已选渠道；省略时兼容旧详情与历史入口。 */
  selectedBindings?: string[]
}
/** 用单一入口冻结计划，历史分页防止重复详情挤占工作区。 */
export function ReleasePlansPanel({ application, selectedBindings }: ReleasePlansPanelProps) {
  const params = useUrlState(),
    batch =
      (selectedBindings ? selectedBindings.length > 1 : params.get('releaseView') === 'batch') &&
      application.platform === 'android'
  return (
    <Flex vertical gap={20} style={{ width: '100%', minWidth: 0 }}>
      {application.platform === 'android' && !selectedBindings && (
        <Segmented
          aria-label="发布方式"
          value={batch ? 'batch' : 'single'}
          options={[
            { value: 'single', label: '单渠道' },
            { value: 'batch', label: '多渠道批次' },
          ]}
          onChange={(value) =>
            updateUrlState({
              releaseView: value === 'batch' ? 'batch' : '',
              batch: '',
              batchRevision: '',
              plan: '',
            })
          }
        />
      )}
      {batch ? (
        <ReleaseBatchesPanel
          key={application.id}
          application={application}
          selectedBindings={selectedBindings}
        />
      ) : (
        <SingleReleasePlansPanel application={application} selectedBindings={selectedBindings} />
      )}
    </Flex>
  )
}
/** 已有单渠道流程独立保留，避免切换批次触发任何自动写入。 */
function SingleReleasePlansPanel({ application, selectedBindings }: ReleasePlansPanelProps) {
  const data = useReleasePlans(application)
  const params = useUrlState()
  const [selectedAttempt, setSelectedAttempt] = useState('')
  const attempt = data.attempts.find((a) => a.id === selectedAttempt)
  const selected = params.get('plan') ?? ''
  function selectPlan(id: string): void {
    updateUrlState({ plan: id })
  }
  const [activePreparation, setActivePreparation] = useState('')
  const opened = useRef('')
  const latest =
    data.preparations.find((p) => p.id === activePreparation) ??
    (selectedBindings ? undefined : data.preparations[0])
  useEffect(() => {
    if (
      latest?.id === activePreparation &&
      latest?.status === 'ready' &&
      latest.planId &&
      data.plans.some((v) => v.plan.id === latest.planId) &&
      opened.current !== latest.id
    ) {
      opened.current = latest.id
      selectPlan(latest.planId)
    }
  }, [latest, activePreparation, data.plans])
  const history = (
    <>
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
                <Button
                  type="link"
                  onClick={() => {
                    selectPlan(v.plan.id)
                  }}
                >
                  查看
                </Button>
              ),
            },
          ]}
        />
      </section>
      <AttemptHistory attempts={data.attempts} onReview={setSelectedAttempt} />
    </>
  )
  return (
    <section aria-label="发布计划" className="release-plans-panel">
      <PageHelp title="准备与确认流程说明">
        <p>
          系统自动检查账号、目标和安装包。准备完成后核对摘要并确认一次：华为按明确选择保存草稿或提交审核，其他已接入
          Android 渠道提交更新，Apple 上传构建。执行回执与审核、上架状态分别展示。
        </p>
      </PageHelp>
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
          artifactIntake={
            <ReleaseArtifactIntake application={application} onChanged={data.refresh} />
          }
          selectedBindingId={selectedBindings?.[0]}
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
                : '请根据上方具体原因处理后重新准备；本次准备未执行商店上传。'
          }
          action={
            latest.planId ? (
              <Button
                onClick={() => {
                  const id = latest.planId ?? ''
                  selectPlan(id)
                }}
              >
                查看发布摘要
              </Button>
            ) : undefined
          }
        />
      )}
      {selectedBindings ? (
        <Collapse
          items={[{ key: 'history', label: '查看历史计划与执行记录', children: history }]}
        />
      ) : (
        history
      )}
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
          selectPlan('')
          setSelectedAttempt(id)
        }}
        onExecute={data.execute}
        disabled={data.busy || data.loading}
        onClose={() => {
          selectPlan('')
        }}
        error={data.error}
        onCancel={(plan) => data.decide(plan, 'cancel')}
      />
    </section>
  )
}
