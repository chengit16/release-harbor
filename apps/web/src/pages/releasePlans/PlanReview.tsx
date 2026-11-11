/** @description 准备后的发布摘要；在同一个抽屉中核对并明确确认一次，关闭不产生授权或上传。 */
import { useEffect, useState } from 'react'
import { Alert, Button, Checkbox, Drawer, Popconfirm, Space } from 'antd'
import {
  planInvalidationMessages,
  isReviewSubmissionAction,
  type ReleaseAttempt,
  type ReleasePlan,
  type ReleasePlanView,
} from '@release-harbor/contracts'
import { TeamRecordAudit } from '../team/TeamRecordAudit.tsx'
import { useTeamAccess } from '../team/teamAccess.tsx'
import { attemptStatus } from './releaseStatus.ts'
import { ReviewTrackingLink } from '../reviewTracking/ReviewTrackingLink.tsx'
import { PlanDetails } from './PlanDetails.tsx'

/** 历史快照也从此入口查看，已消费记录不允许重发。 */
export interface PlanReviewProps {
  /** 当前查询得到的快照及有效性。 */
  view: ReleasePlanView | undefined
  /** 既有执行记录，仅用于展示不可再次使用。 */
  attempt: ReleaseAttempt | undefined
  /** 提交或刷新期间禁止使用旧状态确认。 */
  disabled: boolean
  /** 在抽屉内展示服务端失败，不遮蔽处理建议。 */
  error: string
  /** 关闭只停止查看，不撤销已受理执行。 */
  onClose: () => void
  /** 一次明确同意，服务端原子生成／消费授权并创建执行尝试。 */
  onExecute: (plan: ReleasePlan) => Promise<ReleaseAttempt | null>
  /** 取消尚未执行的计划，历史保留。 */
  onCancel: (plan: ReleasePlan) => Promise<ReleasePlan | null>
  /** 查看原执行原因，不重试或恢复授权。 */
  onReviewAttempt: (id: string) => void
}
/** 去掉授权确认和执行二次弹窗，只保留摘要内的一次明确执行操作。 */
export function PlanReview({
  view,
  attempt,
  disabled,
  error,
  onClose,
  onExecute,
  onCancel,
  onReviewAttempt,
}: PlanReviewProps) {
  const access = useTeamAccess()
  disabled =
    disabled ||
    (!!view &&
      !access.can(view.plan.snapshot.binding, 'release_confirm', view.plan.snapshot.action))
  const [acknowledged, setAcknowledged] = useState(false)
  const plan = view?.plan
  useEffect(() => setAcknowledged(false), [plan?.id])
  const isSubmission = !!plan && isReviewSubmissionAction(plan.snapshot.action)
  const isApple = plan?.snapshot.action === 'apple_upload_build'
  const supported =
    (isApple && plan?.snapshot.releasePolicy?.mode !== 'scheduled') ||
    isSubmission ||
    plan?.snapshot.action === 'huawei_save_draft'
  async function execute(): Promise<void> {
    if (!plan || !acknowledged) return
    if (await onExecute(plan)) onClose()
  }
  return (
    <Drawer
      title="发布摘要"
      open={!!plan}
      onClose={onClose}
      size="large"
      styles={{ wrapper: { maxWidth: '100vw' } }}
      extra={<Button onClick={onClose}>关闭发布摘要</Button>}
    >
      {plan && view && (
        <>
          <TeamRecordAudit
            key={plan.id}
            projectId={plan.snapshot.application.projectId}
            applicationId={plan.snapshot.application.id}
            kind="plan"
            recordId={plan.id}
            version={
              attempt?.reconciliation?.checkedAt ??
              attempt?.finishedAt ??
              attempt?.remoteStartedAt ??
              plan.status
            }
          />
          <Alert
            className="form-feedback"
            showIcon
            type={
              attempt
                ? attempt.status === 'succeeded'
                  ? 'success'
                  : attempt.status === 'failed'
                    ? 'error'
                    : attempt.status === 'needs_reconciliation'
                      ? 'warning'
                      : 'info'
                : view.current
                  ? 'info'
                  : 'warning'
            }
            title={
              attempt
                ? attemptStatus(attempt).label
                : view.invalidatedBy
                  ? planInvalidationMessages[view.invalidatedBy]
                  : '检查已完成，请核对后确认一次'
            }
            description={
              attempt
                ? attemptStatus(attempt).description
                : isApple
                  ? '确认将上传 IPA 并核对对应构建；更新说明和上架类型仅记录意图，不会送审或设置上架。关闭摘要不会上传。'
                  : isSubmission
                    ? plan.snapshot.binding.channel === 'oppo'
                      ? '确认将上传 APK 并提交 OPPO 异步版本任务；文件接收、版本处理成功与审核结果分别核对。关闭摘要不会提交。'
                      : plan.snapshot.binding.channel === 'vivo'
                        ? '确认将上传 APK 并同步提交 vivo 更新；更新受理与审核结果分别核对。关闭摘要不会提交。'
                        : '确认将向所选商店上传更新并提交审核，可能进入后续审核与发布流程；这不是草稿保存。关闭摘要不会提交。'
                    : '关闭摘要不会发起上传。确认保存草稿后将上传安装包，保存成功不代表送审或上线。'
            }
          />
          {attempt && <Button onClick={() => onReviewAttempt(attempt.id)}>查看执行原因</Button>}
          {!supported && (
            <Alert
              type="warning"
              showIcon
              title="该渠道执行暂未开放"
              description="旧 iOS 定时计划不可执行，请重新准备并选择自动发布或手动发布。"
            />
          )}
          {error && (
            <Alert className="form-feedback" role="alert" showIcon type="error" title={error} />
          )}
          <PlanDetails plan={plan} />
          {isSubmission && attempt?.remoteStartedAt && attempt.finishedAt && (
            <ReviewTrackingLink
              projectId={plan.snapshot.application.projectId}
              applicationId={plan.snapshot.application.id}
              recordId={plan.id}
              followBindingId={
                attempt?.status === 'succeeded' ? plan.snapshot.binding.id : undefined
              }
            />
          )}
          {!attempt && plan.status !== 'cancelled' && (
            <>
              <Checkbox
                disabled={disabled || !view.current || !supported}
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              >
                {isApple
                  ? '我已核对 Apple 目标、版本和构建，同意上传 IPA，知晓本次不会提交审核或上架'
                  : isSubmission
                    ? '我已核对目标、安装包、上架类型、复用资料、测试材料与说明，同意向所选商店提交审核'
                    : '我已核对目标、安装包、更新说明与上架意图，同意保存华为草稿'}
              </Checkbox>
              <Space wrap className="plan-review-actions">
                <Button
                  type="primary"
                  loading={disabled}
                  disabled={disabled || !acknowledged || !view.current || !supported}
                  onClick={() => void execute()}
                >
                  {isApple ? '确认上传构建' : isSubmission ? '确认提交审核' : '确认保存草稿'}
                </Button>
                <Popconfirm
                  title="取消本次发布？"
                  description="仅取消尚未执行的计划，历史摘要保留。"
                  okText="取消发布"
                  cancelText="保留"
                  onConfirm={() => onCancel(plan).then(() => undefined)}
                  disabled={disabled}
                >
                  <Button danger disabled={disabled}>
                    取消本次发布
                  </Button>
                </Popconfirm>
              </Space>
            </>
          )}
        </>
      )}
    </Drawer>
  )
}
