/** @description 执行事实详情与人工核对，审核状态仅跳转独立菜单；核对不恢复旧授权或触发商店查询。 */
import { useEffect, useState } from 'react'
import { Alert, Button, Descriptions, Drawer, Typography } from 'antd'
import { ReviewTrackingLink } from '../reviewTracking/ReviewTrackingLink.tsx'
import { reconciliationStatus } from './releaseStatus.ts'
import { ReconciliationModal } from './ReconciliationModal.tsx'
import {
  isPackageTargetChannel,
  isReviewSubmissionAction,
  attemptMessages,
  executionDiagnostics,
  type ReleaseAttempt,
  type ReleasePlan,
  type ReconcileAttemptInput,
} from '@release-harbor/contracts'

/** 详情依赖同应用的安全计划快照，核对提交成功后由 Hook 重新读取。 */
export interface AttemptReviewProps {
  /** 未选择记录时关闭。 */
  attempt: ReleaseAttempt | undefined
  /** 目标、产物及版本只读来源。 */
  plan: ReleasePlan | undefined
  /** 正在写入或重读时禁止核对。 */
  disabled: boolean
  /** 服务端或网络失败在当前对话框内可见，保留输入。 */
  error: string
  /** 关闭详情不会撤销执行。 */
  onClose: () => void
  /** 仅记录人工事实，失败保留表单。 */
  onSave: (attempt: ReleaseAttempt, input: ReconcileAttemptInput) => Promise<ReleaseAttempt | null>
}
/** 系统执行与人工声明分区，避免把手工确认显示为自动商店成功。 */
export function AttemptReview({
  attempt,
  plan,
  disabled,
  error,
  onClose,
  onSave,
}: AttemptReviewProps) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    setOpen(false)
  }, [attempt?.id])
  const s = plan?.snapshot
  return (
    <>
      <Drawer
        title="执行记录详情"
        open={!!attempt}
        onClose={onClose}
        size="large"
        styles={{ wrapper: { maxWidth: '100vw' } }}
        extra={<Button onClick={onClose}>关闭执行详情</Button>}
      >
        {attempt && (
          <div className="plan-details">
            <Alert
              showIcon
              type={
                attempt.status === 'succeeded'
                  ? 'success'
                  : attempt.status === 'needs_reconciliation'
                    ? 'warning'
                    : 'info'
              }
              title={attemptMessages[attempt.code]}
              className="form-feedback"
            />
            {plan &&
              s &&
              isReviewSubmissionAction(s.action) &&
              attempt.remoteStartedAt &&
              attempt.finishedAt && (
                <ReviewTrackingLink
                  projectId={plan.snapshot.application.projectId}
                  applicationId={plan.snapshot.application.id}
                  recordId={plan.id}
                />
              )}
            <Descriptions
              column={1}
              items={[
                {
                  key: 'attempt',
                  label: '执行编号',
                  children: <Typography.Text copyable>{attempt.id}</Typography.Text>,
                },
                {
                  key: 'target',
                  label: '商店目标',
                  children: s
                    ? `${s.application.name} · ${s.binding.channel} · ${isPackageTargetChannel(s.binding.channel) ? '包名' : 'App ID'} ${s.binding.appId}`
                    : '计划快照未能加载，请重新读取',
                },
                { key: 'identifier', label: '应用身份', children: s?.application.identifier },
                {
                  key: 'version',
                  label: '版本 / 构建号',
                  children: s?.artifact.identity
                    ? `${s.artifact.identity.versionName} / ${s.artifact.identity.buildNumber}`
                    : '未记录',
                },
                {
                  key: 'sha',
                  label: '安装包 SHA-256',
                  children: <Typography.Text copyable>{s?.artifact.sha256}</Typography.Text>,
                },
                {
                  key: 'digest',
                  label: '计划 SHA-256',
                  children: <Typography.Text copyable>{plan?.digest}</Typography.Text>,
                },
                {
                  key: 'permission',
                  label: '写入许可',
                  children: attempt.remoteStartedAt
                    ? `已授予：${new Date(attempt.remoteStartedAt).toLocaleString()}`
                    : '未授予本项目执行器的远端写入许可',
                },
                {
                  key: 'finished',
                  label: '结束时间',
                  children: attempt.finishedAt
                    ? new Date(attempt.finishedAt).toLocaleString()
                    : '执行中',
                },
              ]}
            />
            {attempt.finishedAt && attempt.status !== 'succeeded' && (
              <Alert
                className="form-feedback"
                showIcon
                type="warning"
                title="原因与处理建议"
                description={
                  attempt.diagnostic
                    ? executionDiagnostics[attempt.diagnostic]
                    : '历史记录未保存具体原因，无法事后推断；请根据原始结果和许可记录核对。'
                }
              />
            )}
            {attempt.reconciliation && (
              <Alert
                showIcon
                type="info"
                title="用户人工核对结果"
                description={`${reconciliationStatus(attempt.reconciliation.decision)}。记录时间：${new Date(attempt.reconciliation.checkedAt).toLocaleString()}。这不是系统自动查询结果，原始执行事实和旧授权保持不变。`}
              />
            )}
            {attempt.status === 'needs_reconciliation' && !attempt.reconciliation && (
              <>
                <Alert
                  className="form-feedback"
                  showIcon
                  type="warning"
                  title="先到商店后台核对"
                  description="请核对上述 App ID、版本、安装包和处理中任务。仍不确定时保持阻塞；记录结论不会自动上传或重试。"
                />
                <Button
                  type="primary"
                  disabled={disabled || !plan}
                  onClick={() => {
                    setOpen(true)
                  }}
                >
                  记录人工核对
                </Button>
              </>
            )}
          </div>
        )}
      </Drawer>
      <ReconciliationModal
        open={open}
        attempt={attempt}
        plan={plan}
        disabled={disabled}
        error={error}
        onClose={() => setOpen(false)}
        onSave={onSave}
      />
    </>
  )
}
