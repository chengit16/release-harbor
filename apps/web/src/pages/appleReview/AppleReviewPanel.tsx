/** @description iOS 已有构建审核及手动发布工作台；只读刷新、准备摘要与一次确认各有明确作用。 */
import { useRef, useState } from 'react'
import { Alert, Button, Form, Input, Radio, Select, Space, Table, Tag, Typography } from 'antd'
import {
  appleReviewMessages,
  appleVersionStates,
  type Application,
  type AppleReviewRecord,
} from '@release-harbor/contracts'
import { useTeamAccess } from '../team/teamAccess.tsx'
import { usePublicDraft } from '../../hooks/usePublicDraft.ts'
import { updateUrlState, useUrlState } from '../../app/useUrlState.ts'
import { ReviewTrackingLink } from '../reviewTracking/ReviewTrackingLink.tsx'
import { useAppleReview } from './useAppleReview.ts'
import { AppleReviewSummary } from './AppleReviewSummary.tsx'
import { AppleReconciliation } from './AppleReconciliation.tsx'

/** 审核工作区在当前 iOS 应用下挂载，应用切换通过 key 清理异步上下文。 */
export interface AppleReviewPanelProps {
  /** 当前应用来自公开接口，不作为服务端授权。 */ application: Application
}
/**
 * 远端列表只有点击刷新才查询；历史轮询不消费授权。
 * 长函数保留原因：在同页组合一份局部表单与两个事实表格，网络及状态在 Hook，摘要和人工核对已独立拆分。
 */
export function AppleReviewPanel({ application }: AppleReviewPanelProps) {
  // 1. 当前应用共享一份草稿，查询和本机历史保持不同来源。
  const access = useTeamAccess()
  const model = useAppleReview(application),
    [form] = Form.useForm()
  const publicDraft = usePublicDraft(`apple:${application.projectId}:${application.id}`, [
    'notes',
    'mode',
    'action',
  ])
  const binding = Form.useWatch('bindingId', form),
    buildId = Form.useWatch('buildId', form),
    action = Form.useWatch('action', form) ?? 'submit'
  const selectedId = useUrlState().get('appleRecord') ?? ''
  const [prepared, setPrepared] = useState<AppleReviewRecord>()
  const [reconcile, setReconcile] = useState<AppleReviewRecord>()
  function selectRecord(id: string): void {
    updateUrlState({ appleRecord: id })
  }
  const draft = useRef({ key: '', id: '' })
  const build = model.catalog?.builds.find((b) => b.id === buildId)
  // URL 决定详情定位，新准备结果暂存到首次历史读取前；不回退到另一记录。
  const current =
    model.records.find((r) => r.id === selectedId) ??
    (prepared?.id === selectedId ? prepared : undefined)
  // 2. 未知响应复用请求编号，明确准备成功后才允许下一份新意图。
  async function prepare(v: {
    bindingId: string
    buildId: string
    versionId: string
    action: 'submit' | 'release'
    mode: 'manual' | 'after_approval'
    notes?: string
  }): Promise<void> {
    const input = {
      ...v,
      mode: v.action === 'release' ? 'manual' : v.mode,
      notes: v.action === 'release' ? '' : (v.notes ?? '').trim(),
    }
    const key = JSON.stringify(input)
    if (draft.current.key !== key || !draft.current.id)
      draft.current = { key, id: crypto.randomUUID() }
    const r = await model.prepare({ ...input, requestId: draft.current.id })
    if (r) {
      publicDraft.clear()
      setPrepared(r)
      selectRecord(r.id)
      draft.current.id = ''
    }
  }
  // 3. 明确准备、摘要确认和历史观察的边界，渲染不自动请求商店。
  return (
    <section aria-label="Apple 审核与发布">
      <Alert
        className="form-feedback"
        showIcon
        type="info"
        title="复用已有构建，准备后确认一次"
        description="提交审核不会重新上传 IPA；手动发布仅用于已批准且等待开发者发布的版本。隐私、评级、合同和合规资料仍须 Apple 最终校验。"
      />
      {model.loading && (
        <Typography.Paragraph role="status">正在读取审核记录…</Typography.Paragraph>
      )}
      {model.historyError && (
        <Alert
          role="alert"
          type="error"
          showIcon
          title={model.historyError}
          action={<Button onClick={model.refresh}>重新读取审核记录</Button>}
        />
      )}
      {selectedId && !current && !model.loading && !model.historyError && (
        <Alert
          role="alert"
          type="warning"
          showIcon
          title="当前应用下找不到该审核记录。"
          action={<Button onClick={() => selectRecord('')}>返回审核记录</Button>}
        />
      )}
      {model.error && (
        <Alert className="form-feedback" role="alert" showIcon type="error" title={model.error} />
      )}
      {model.catalog &&
        build &&
        !model.catalog.versions.some((v) => v.version === build.version) && (
          <Alert
            className="form-feedback"
            type="warning"
            showIcon
            title="Apple 后台尚无对应商店版本"
            description="请先在 App Store Connect 为此营销版本创建 App Store 版本并完善资料，再刷新本页；本次不会自动创建空版本或代填合规材料。"
          />
        )}
      <Form
        form={form}
        layout="vertical"
        scrollToFirstError={{ focus: true }}
        onFinish={prepare}
        initialValues={{ action: 'submit', mode: 'after_approval', ...publicDraft.initialValues }}
        onValuesChange={(_, values) => publicDraft.save(values)}
        disabled={model.busy}
      >
        <Form.Item name="bindingId" label="Apple 商店绑定" rules={[{ required: true }]}>
          <Select
            aria-label="Apple 商店绑定"
            options={model.bindings.map((b) => ({
              value: b.id,
              label: `Apple · App ID ${b.appId}`,
            }))}
            onChange={() => {
              model.clearCatalog()
              form.setFieldsValue({ buildId: undefined, versionId: undefined })
            }}
          />
        </Form.Item>
        <Button
          disabled={!binding || !access.can(binding, 'release_prepare') || model.busy}
          loading={model.busy}
          onClick={() => void model.query(binding)}
        >
          刷新 Apple 构建与状态
        </Button>
        {model.catalog && (
          <Typography.Paragraph type="secondary">
            Apple 查询时间：{new Date(model.catalog.checkedAt).toLocaleString()}
            ；显示查询时事实，页面刷新只读取本机记录。
          </Typography.Paragraph>
        )}
        <Form.Item name="action" label="本次操作">
          <Radio.Group
            options={[
              {
                value: 'submit',
                label: '提交审核',
                disabled: !access.can(binding, 'release_prepare', 'apple_submit_review'),
              },
              {
                value: 'release',
                label: '手动发布已批准版本',
                disabled: !access.can(binding, 'release_prepare', 'apple_release'),
              },
            ]}
          />
        </Form.Item>
        <Form.Item name="buildId" label="已有 Apple 构建" rules={[{ required: true }]}>
          <Select
            aria-label="已有 Apple 构建"
            placeholder="先刷新 Apple 构建"
            onChange={() => form.setFieldValue('versionId', undefined)}
            options={(model.catalog?.builds ?? []).map((b) => ({
              value: b.id,
              label: `${b.version} (${b.number}) · ${b.state}${b.expired ? ' · 已过期' : ''}`,
              disabled: b.state !== 'VALID' || b.expired,
            }))}
          />
        </Form.Item>
        <Form.Item name="versionId" label="对应商店版本" rules={[{ required: true }]}>
          <Select
            aria-label="对应商店版本"
            options={(model.catalog?.versions ?? [])
              .filter((v) => v.version === build?.version)
              .map((v) => ({ value: v.id, label: `${v.version} · ${v.state}` }))}
          />
        </Form.Item>
        {action === 'submit' ? (
          <>
            <Form.Item name="mode" label="发布方式" rules={[{ required: true }]}>
              <Radio.Group
                options={[
                  { value: 'after_approval', label: '审核通过后自动发布' },
                  { value: 'manual', label: '审核通过后手动发布' },
                ]}
              />
            </Form.Item>
            <Form.Item
              name="notes"
              label="本次更新说明"
              rules={[{ required: true, whitespace: true }, { max: 4000 }]}
            >
              <Input.TextArea aria-label="本次更新说明" maxLength={4000} rows={4} showCount />
            </Form.Item>
          </>
        ) : (
          <Alert
            className="form-feedback"
            showIcon
            type="warning"
            title="只允许待开发者发布且构建匹配的手动版本"
            description="确认后会发起发布请求，请先确认确实准备上线。"
          />
        )}
        <Button
          type="primary"
          htmlType="submit"
          loading={model.busy}
          disabled={
            !model.catalog ||
            !access.can(
              binding,
              'release_prepare',
              action === 'release' ? 'apple_release' : 'apple_submit_review',
            ) ||
            model.busy
          }
        >
          {action === 'submit' ? '准备 Apple 审核' : '准备手动发布'}
        </Button>
      </Form>
      <Typography.Title level={4}>商店版本状态</Typography.Title>
      <Table
        size="small"
        rowKey="id"
        pagination={{ pageSize: 5 }}
        scroll={{ x: 500 }}
        dataSource={model.catalog?.versions ?? []}
        columns={[
          { title: '版本', dataIndex: 'version' },
          { title: 'Apple 状态', dataIndex: 'state', render: (v) => appleVersionStates[v] ?? v },
          {
            title: '发布方式',
            dataIndex: 'releaseType',
            render: (v) => (v === 'MANUAL' ? '手动发布' : v === 'AFTER_APPROVAL' ? '自动发布' : v),
          },
        ]}
      />
      <Typography.Title level={4}>审核与发布记录</Typography.Title>
      <Table
        size="small"
        rowKey="id"
        pagination={{ pageSize: 5 }}
        scroll={{ x: 600 }}
        dataSource={model.records}
        columns={[
          {
            title: '操作与构建',
            render: (_, r) => (
              <>
                {r.snapshot.action === 'submit' ? 'Apple 提交审核' : 'Apple 手动发布'}
                <br />
                <Typography.Text type="secondary">
                  {r.snapshot.build.version} ({r.snapshot.build.number})
                </Typography.Text>
              </>
            ),
          },
          {
            title: '本地执行事实',
            render: (_, r) => (
              <>
                <Tag
                  color={
                    r.status === 'succeeded'
                      ? 'success'
                      : r.status === 'unknown'
                        ? 'warning'
                        : r.status === 'failed'
                          ? 'error'
                          : 'default'
                  }
                >
                  {r.status === 'ready'
                    ? '待确认'
                    : r.status === 'running'
                      ? '执行中'
                      : r.status === 'unknown'
                        ? '待核对'
                        : r.status === 'succeeded'
                          ? '已受理'
                          : '未执行'}
                </Tag>
                <div>{appleReviewMessages[r.code]}</div>
                {r.observation && (
                  <Typography.Text type="secondary">
                    远端观察：{appleVersionStates[r.observation.state] ?? r.observation.state} ·{' '}
                    {new Date(r.observation.checkedAt).toLocaleString()}
                  </Typography.Text>
                )}
                {r.reconciliation && (
                  <div>
                    用户人工核对：
                    {r.reconciliation.decision === 'present' ? '已受理' : '未执行且无处理中任务'}
                  </div>
                )}
              </>
            ),
          },
          {
            title: '操作',
            render: (_, r) => (
              <Space wrap>
                <Button onClick={() => selectRecord(r.id)}>查看摘要</Button>
                {r.remoteStartedAt && r.finishedAt && (
                  <ReviewTrackingLink
                    projectId={application.projectId}
                    applicationId={application.id}
                    recordId={r.id}
                    followBindingId={
                      r.status === 'succeeded' && r.snapshot.action === 'submit'
                        ? r.snapshot.binding.id
                        : undefined
                    }
                    kind="apple"
                  />
                )}
                {r.status === 'unknown' && !r.reconciliation && (
                  <Button onClick={() => setReconcile(r)}>记录人工核对</Button>
                )}
              </Space>
            ),
          },
        ]}
      />
      <AppleReviewSummary
        record={current}
        busy={model.busy}
        error={model.error}
        onClose={() => selectRecord('')}
        onExecute={model.execute}
      />
      <AppleReconciliation
        record={reconcile}
        busy={model.busy}
        error={model.error}
        onClose={() => setReconcile(undefined)}
        onSave={model.reconcile}
      />
    </section>
  )
}
