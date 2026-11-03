/** @description 计划复核抽屉及显式确认对话框；关闭确认不写入，取消计划单独确认。 */
import { useEffect, useState } from 'react'
import { Alert, Button, Checkbox, Drawer, Modal, Popconfirm, Space } from 'antd'
import {
  planInvalidationMessages,
  releaseActions,
  type ReleasePlan,
  type ReleasePlanView,
} from '@release-harbor/contracts'
import { PlanDetails } from './PlanDetails.tsx'

/** 仅面向服务端已返回计划，当前状态由查询刷新。 */
export interface PlanReviewProps {
  /** 未选中时关闭抽屉。 */
  view: ReleasePlanView | undefined
  /** 写入或重读期间禁止确认旧状态。 */
  disabled: boolean
  /** 关闭只读详情不取消已冻结计划。 */
  onClose: () => void
  /** 变更后刷新事实，失败保留计划。 */
  onDecide: (plan: ReleasePlan, decision: 'confirm' | 'cancel') => Promise<ReleasePlan | null>
}
/** 完整快照先复核，再明确勾选并确认；没有执行按钮。 */
export function PlanReview({ view, disabled, onClose, onDecide }: PlanReviewProps) {
  const [confirming, setConfirming] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const plan = view?.plan
  useEffect(() => {
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
                    ? '已记录限定确认；执行能力待接入'
                    : '计划已冻结，等待人工确认'
              }
              description="确认仅适用于此快照与有效期限。上传权限尚未验证；本轮没有向商店上传、送审或上线。"
              className="form-feedback"
            />
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
              {plan.status !== 'cancelled' && (
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
              确认只对上述快照生效，不超过原预检期限。文件、说明或配置变化必须重新冻结并确认；本轮确认后尚不执行上传。
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
