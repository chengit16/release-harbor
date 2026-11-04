/** @description 计划复核抽屉及显式确认对话框；关闭确认不写入，取消计划单独确认。 */
import { useEffect, useState } from 'react'
import { Alert, Button, Checkbox, Drawer, Modal, Popconfirm, Space } from 'antd'
import {
  planInvalidationMessages,
  releaseActions,
  type ReleaseAttempt,
  type ReleasePlan,
  type ReleasePlanView,
} from '@release-harbor/contracts'
import { PlanDetails } from './PlanDetails.tsx'

/** 仅面向服务端已返回计划，当前状态由查询刷新。 */
export interface PlanReviewProps {
  /** 未选中时关闭抽屉。 */
  view: ReleasePlanView | undefined
  /** 已消费计划禁止重复操作。 */
  attempt: ReleaseAttempt | undefined
  /** 显式执行，不由确认或刷新触发。 */
  onExecute: (plan: ReleasePlan) => Promise<ReleaseAttempt | null>
  /** 写入或重读期间禁止确认旧状态。 */
  disabled: boolean
  /** 关闭只读详情不取消已冻结计划。 */
  onClose: () => void
  /** 变更后刷新事实，失败保留计划。 */
  onDecide: (plan: ReleasePlan, decision: 'confirm' | 'cancel') => Promise<ReleasePlan | null>
}
/** 完整快照先复核，再明确勾选并确认；执行必须再次明确同意。 */
export function PlanReview({
  view,
  attempt,
  onExecute,
  disabled,
  onClose,
  onDecide,
}: PlanReviewProps) {
  const [executing, setExecuting] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const plan = view?.plan
  useEffect(() => {
    setExecuting(false)
    setConfirming(false)
    setAcknowledged(false)
  }, [plan?.id])
  async function confirm(): Promise<void> {
    if (!plan || !acknowledged) return
    const result = await onDecide(plan, 'confirm')
    if (result) setConfirming(false)
  }
  return (
    <>
      <Drawer
        title="发布计划复核"
        open={!!plan}
        onClose={onClose}
        size="large"
        styles={{ wrapper: { maxWidth: '100vw' } }}
        extra={<Button onClick={onClose}>关闭计划详情</Button>}
      >
        {plan && view && (
          <>
            <Alert
              showIcon
              type={view.current ? 'info' : 'warning'}
              title={
                view.invalidatedBy
                  ? planInvalidationMessages[view.invalidatedBy]
                  : plan.status === 'confirmed'
                    ? '已记录限定确认，请复核后显式执行'
                    : '计划已冻结，等待人工确认'
              }
              description="确认仅适用于此快照与有效期限。执行后请查看回执，草稿保存不代表送审或上线。"
              className="form-feedback"
            />
            {plan.snapshot.action === 'apple_upload_build' && (
              <Alert
                showIcon
                type="warning"
                title="Apple 构建上传暂不可用"
                description="当前上传适配不能使用已配置的 API Key，确认会保留；请等待兼容完善。"
              />
            )}
            <PlanDetails plan={plan} />
            <Space wrap className="plan-review-actions">
              {plan.status === 'frozen' && (
                <Button
                  type="primary"
                  disabled={disabled || !view.current}
                  onClick={() => {
                    setAcknowledged(false)
                    setConfirming(true)
                  }}
                >
                  核对并确认
                </Button>
              )}
              {plan.status === 'confirmed' && !attempt && (
                <Button
                  type="primary"
                  disabled={
                    disabled || !view.current || plan.snapshot.action !== 'huawei_save_draft'
                  }
                  onClick={() => {
                    setAcknowledged(false)
                    setExecuting(true)
                  }}
                >
                  执行此计划
                </Button>
              )}
              {attempt && <Alert type="info" title="本次授权已消费，请查看执行记录" />}
              {plan.status !== 'cancelled' && !attempt && (
                <Popconfirm
                  title="取消这份发布计划？"
                  description="原确认将撤销，历史快照仍保留。"
                  onConfirm={() => onDecide(plan, 'cancel').then(() => undefined)}
                  okText="取消计划"
                  cancelText="保留计划"
                  disabled={disabled}
                >
                  <Button danger disabled={disabled}>
                    取消计划
                  </Button>
                </Popconfirm>
              )}
            </Space>
          </>
        )}
      </Drawer>
      <Modal
        title="执行此计划"
        open={executing && !!plan}
        onCancel={() => setExecuting(false)}
        okText="开始保存草稿"
        cancelText="返回复核"
        confirmLoading={disabled}
        okButtonProps={{ disabled: disabled || !acknowledged || !view?.current || !!attempt }}
        onOk={async () => {
          if (plan && acknowledged && (await onExecute(plan))) setExecuting(false)
        }}
      >
        {plan && (
          <>
            <p>
              {plan.snapshot.application.name} · App ID {plan.snapshot.binding.appId}
            </p>
            <p>
              {releaseActions[plan.snapshot.action]} ·{' '}
              {plan.snapshot.artifact.identity?.versionName} (
              {plan.snapshot.artifact.identity?.buildNumber})
            </p>
            <p>
              本次确认只能执行一次。远端开始后关闭页面或停止服务不会撤回；结果不明时须先到商店核对，不会自动重试。
            </p>
            <Checkbox checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)}>
              我确认向上述目标保存此安装包与更新说明
            </Checkbox>
          </>
        )}
      </Modal>
      <Modal
        title="确认本次发布范围"
        open={confirming && !!plan}
        onCancel={() => setConfirming(false)}
        onOk={() => void confirm()}
        okText="确认此计划"
        cancelText="返回复核"
        confirmLoading={disabled}
        okButtonProps={{ disabled: disabled || !acknowledged || !view?.current }}
      >
        {plan && (
          <>
            <p>
              {plan.snapshot.application.name} · App ID {plan.snapshot.binding.appId}
            </p>
            <p>
              {releaseActions[plan.snapshot.action]} ·{' '}
              {plan.snapshot.artifact.identity?.versionName} (
              {plan.snapshot.artifact.identity?.buildNumber})
            </p>
            <p>
              确认只对上述快照生效，不超过原预检期限。文件、说明或配置变化必须重新冻结并确认；确认后需要再次显式点击执行。
            </p>
            <Checkbox
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            >
              我已核对应用、目标、安装包、动作及完整更新说明
            </Checkbox>
          </>
        )}
      </Modal>
    </>
  )
}
