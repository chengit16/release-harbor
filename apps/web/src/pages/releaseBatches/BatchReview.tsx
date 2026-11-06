/** @description 一份批次摘要一次确认；逐行保留动作、包、说明和真实结果，关闭抽屉不会授权。 */
import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  Collapse,
  Descriptions,
  Drawer,
  Progress,
  Space,
  Tag,
  Typography,
} from 'antd'
import {
  channelLabels,
  releaseActions,
  attemptMessages,
  type ReleaseBatch,
  type BatchRevision,
  type ReleasePlan,
  type ReleaseAttempt,
  type BatchTargetStatus,
  type ChannelBinding,
} from '@release-harbor/contracts'
import { PlanDetails } from '../releasePlans/PlanDetails.tsx'

/** 状态仅描述本机事实，不把审核受理当作已上架。 */
export const batchStatusLabels: Record<BatchTargetStatus, string> = {
  pending: '等待准备',
  checking: '只读检查中',
  ready: '已准备',
  failed: '未执行失败',
  queued: '等待执行',
  verifying: '执行前复核',
  running: '执行中',
  succeeded: '操作完成',
  needs_reconciliation: '待核对',
  stopped: '已停止',
  expired: '需重新准备',
  interrupted: '已中断',
}
/** 已加载的完整批次及服务端子计划；确认只提交摘要，不能修改目标。 */
export interface BatchReviewProps {
  /** 当前应用所选批次，未选择时不展示。 */
  batch?: ReleaseBatch
  /** 不可变准备版本，旧版本不可重新授权。 */
  revision?: BatchRevision
  /** 服务器加载的安全子计划集合。 */
  plans: ReleasePlan[]
  /** 独立回执与人工核对事实。 */
  attempts: ReleaseAttempt[]
  /** 失败行未生成计划时用于显示原渠道目标。 */
  bindings: ChannelBinding[]
  /** 只控制摘要可见性。 */
  open: boolean
  /** 写请求期间禁止重复确认。 */
  busy: boolean
  /** 经过统一客户端处理的公开错误。 */
  error: string
  /** 关闭仅影响查看，不停止服务端。 */
  onClose: () => void
  /** 用户确认当前摘要一次，服务端验证限定范围。 */
  onConfirm: () => Promise<void>
  /** 显式停止未取得许可的项。 */
  onStop: () => Promise<void>
  /** 打开原执行记录及人工核对入口。 */
  onAttempt: (id: string) => void
}
/** 长函数保留原因：摘要与逐行回执使用同一不可变快照，声明式明细集中保留便于核对。
 * 固定一小时首次写入窗口，排队项必须临执行复核，不续旧预检。 */
export function BatchReview({
  batch,
  revision: r,
  plans,
  attempts,
  bindings,
  open,
  busy,
  error,
  onClose,
  onConfirm,
  onStop,
  onAttempt,
}: BatchReviewProps) {
  // 1. 确认意图限定当前摘要，关闭或历史切换不会携带其他版本的勾选。
  const [ack, setAck] = useState(false),
    [now, setNow] = useState(Date.now())
  useEffect(() => setAck(false), [r?.id])
  useEffect(() => {
    if (!open) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [open])
  if (!batch || !r) return null
  // 2. 历史摘要只读，界面期限用于提示；确认仍由服务端复核所有依赖。
  const confirmable =
    batch.revisions.at(-1)?.id === r.id &&
    !!r.digest &&
    !!r.preparedAt &&
    !r.run &&
    now < Date.parse(r.preparedAt) + 300000
  const done = r.targets.filter(
    (t) => !['pending', 'checking', 'queued', 'verifying', 'running'].includes(t.status),
  ).length
  // 3. 逐项显示真实动作、时间与回执，进度结束不等于商店审核通过。
  return (
    <Drawer
      title={r.run ? '批次执行详情' : '批次发布摘要'}
      open={open}
      onClose={onClose}
      size={960}
      extra={
        <Space wrap>
          {r.run && !r.run.finishedAt && (
            <Button danger disabled={busy || !!r.run.stoppedAt} onClick={() => void onStop()}>
              停止后续执行
            </Button>
          )}
          <Button onClick={onClose}>关闭批次详情</Button>
        </Space>
      }
      footer={
        !r.run ? (
          <Space orientation="vertical" style={{ width: '100%' }}>
            {error && <Alert type="error" showIcon role="alert" title={error} />}
            <Checkbox
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
              disabled={!confirmable}
            >
              我已核对以下 {r.targets.length}{' '}
              个渠道的目标、安装包、更新说明和真实动作，同意在一小时内逐项开始写入。
            </Checkbox>
            <Button
              type="primary"
              loading={busy}
              disabled={!ack || !confirmable || busy}
              onClick={() => void onConfirm()}
            >
              确认执行 {r.targets.length} 个渠道
            </Button>
          </Space>
        ) : undefined
      }
    >
      <Space orientation="vertical" size={20} style={{ width: '100%' }}>
        <Alert
          showIcon
          type={r.run ? 'info' : r.digest ? 'success' : 'warning'}
          title={
            r.run
              ? '批次已确认，各渠道独立执行和记账'
              : r.digest
                ? '请核对全部渠道后确认一次'
                : '准备未全部通过，请修正或明确移除失败行后重新准备'
          }
          description="华为 Android 保存草稿；其余渠道执行各自的更新提交。操作完成不代表审核通过或已上架。关闭页面不会停止任务。"
        />
        <Descriptions
          column={1}
          size="small"
          items={[
            {
              key: 'created',
              label: '摘要准备时间',
              children: r.preparedAt ? new Date(r.preparedAt).toLocaleString() : '尚未完成',
            },
            {
              key: 'window',
              label: r.run ? '开始写入截止' : '摘要确认期限',
              children: r.run
                ? new Date(r.run.consent.expiresAt).toLocaleString()
                : r.preparedAt
                  ? new Date(Date.parse(r.preparedAt) + 300000).toLocaleString()
                  : '等待准备',
            },
            {
              key: 'order',
              label: '执行方式',
              children: '按以下顺序串行执行；每项写入前重新检查原意图。',
            },
          ]}
        />
        {r.run && (
          <Progress
            percent={Math.round((done / r.targets.length) * 100)}
            format={() => `${done} / ${r.targets.length} 项已结束`}
            status={
              r.targets.some((t) => t.status === 'needs_reconciliation')
                ? 'exception'
                : r.run.finishedAt
                  ? 'normal'
                  : 'active'
            }
          />
        )}
        {r.targets.map((t, index) => {
          const plan = plans.find((p) => p.id === t.planId),
            a = attempts.find((a) => a.id === t.attemptId),
            s = plan?.snapshot,
            binding = s?.binding ?? bindings.find((b) => b.id === t.input.bindingId)
          return (
            <section
              key={t.id}
              aria-label={`批次目标 ${index + 1}`}
              style={{
                border: '1px solid var(--border-color, #dce3ed)',
                borderRadius: 8,
                padding: 16,
              }}
            >
              <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
                <Typography.Text strong>
                  {index + 1}. {binding ? channelLabels[binding.channel] : '渠道检查'}
                  {s ? ` · ${releaseActions[s.action]}` : ''}
                </Typography.Text>
                <Tag
                  color={
                    t.status === 'succeeded'
                      ? 'success'
                      : t.status === 'failed'
                        ? 'error'
                        : t.status === 'needs_reconciliation'
                          ? 'warning'
                          : undefined
                  }
                >
                  {batchStatusLabels[t.status]}
                </Tag>
              </Space>
              <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
                {a ? attemptMessages[a.code] : t.message}
              </Typography.Paragraph>
              {!plan && (
                <Typography.Paragraph type="secondary">
                  商店目标：{binding?.appId ?? '绑定已变更'} · {t.input.releaseNotes}
                </Typography.Paragraph>
              )}
              {plan && (
                <>
                  <Descriptions
                    size="small"
                    column={{ xs: 1, sm: 2 }}
                    items={[
                      { key: 'target', label: '商店目标', children: s?.binding.appId },
                      {
                        key: 'account',
                        label: '商店账号引用',
                        children: (
                          <Typography.Text style={{ overflowWrap: 'anywhere' }}>
                            {s?.binding.credentialReference}
                          </Typography.Text>
                        ),
                      },
                      { key: 'file', label: '安装包', children: s?.artifact.fileName },
                      {
                        key: 'sha',
                        label: 'SHA-256',
                        children: (
                          <Typography.Text
                            copyable={{ text: s?.artifact.sha256 ?? '' }}
                            style={{ overflowWrap: 'anywhere' }}
                          >
                            {s?.artifact.sha256}
                          </Typography.Text>
                        ),
                      },
                      {
                        key: 'version',
                        label: '版本 / 构建',
                        children: `${s?.artifact.identity?.versionName} (${s?.artifact.identity?.buildNumber})`,
                      },
                      {
                        key: 'policy',
                        label: '上架方式',
                        children: (
                          <>
                            {s?.releasePolicy?.mode === 'scheduled'
                              ? new Date(s.releasePolicy.notBefore).toLocaleString()
                              : '审核通过后立即上架'}
                            {s?.binding.channel === 'huawei' ? '（仅记录意图）' : ''}
                          </>
                        ),
                      },
                      {
                        key: 'checked',
                        label: '只读检查时间',
                        children: (
                          <>
                            {new Date(plan.snapshot.preflight.createdAt).toLocaleString()}
                            {now >= Date.parse(plan.snapshot.preflight.expiresAt ?? '')
                              ? ' · 待执行前复核'
                              : ''}
                          </>
                        ),
                      },
                    ]}
                  />
                  <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>
                    {s?.releaseNotes}
                  </Typography.Paragraph>
                  <Collapse
                    size="small"
                    items={[
                      {
                        key: 'details',
                        label: '完整快照与核对指纹',
                        children: <PlanDetails plan={plan} />,
                      },
                    ]}
                  />
                </>
              )}
              {a && (
                <Button type="link" onClick={() => onAttempt(a.id)}>
                  查看执行回执{a.status === 'needs_reconciliation' ? '与人工核对' : ''}
                </Button>
              )}
            </section>
          )
        })}
        {r.run?.stoppedAt && (
          <Alert
            type="warning"
            showIcon
            title="已停止后续执行。已获写许可的操作仍按真实结果保存，不表示撤回商店操作。"
          />
        )}
        {r.digest && (
          <Typography.Text type="secondary" style={{ overflowWrap: 'anywhere' }}>
            批次摘要：{r.digest}
          </Typography.Text>
        )}
      </Space>
    </Drawer>
  )
}
