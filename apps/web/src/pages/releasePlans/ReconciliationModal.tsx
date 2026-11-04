/** @description 人工核对的独立表单与明确同意边界；只提交固定结论和公开版本信息。 */
import { useEffect } from 'react'
import { Alert, Checkbox, Form, Input, Modal, Radio } from 'antd'
import type { ReleaseAttempt, ReleasePlan, ReconcileAttemptInput } from '@release-harbor/contracts'

/** 不确定结论不可提交；关闭后下次打开清空旧草稿。 */
export interface ReconciliationModalProps {
  /** 表单可见性由详情入口控制。 */
  open: boolean
  /** 仅当前所选安全记录可核对。 */
  attempt: ReleaseAttempt | undefined
  /** 只读版本及摘要来源。 */
  plan: ReleasePlan | undefined
  /** 请求期间禁止重复提交。 */
  disabled: boolean
  /** 服务端或网络失败在当前对话框内可见，保留输入。 */
  error: string
  /** 取消或保存成功关闭，不撤销已受理写入。 */
  onClose: () => void
  /** 保存声明后刷新服务端事实，失败保留输入。 */
  onSave: (attempt: ReleaseAttempt, input: ReconcileAttemptInput) => Promise<ReleaseAttempt | null>
}
interface Fields {
  decision: 'draft_present' | 'no_draft' | 'uncertain'
  versionName: string
  buildNumber: string
  acknowledged: boolean
}
/** 输入校验只负责交互，来源、归属与最终状态仍由服务端检查。 */
export function ReconciliationModal({
  open,
  attempt,
  plan,
  disabled,
  error,
  onClose,
  onSave,
}: ReconciliationModalProps) {
  const [form] = Form.useForm<Fields>()
  const decision = Form.useWatch('decision', form)
  const acknowledged = Form.useWatch('acknowledged', form)
  useEffect(() => {
    form.resetFields()
  }, [open, attempt?.id, form])
  async function save(values: Fields): Promise<void> {
    if (!attempt || !plan || !values.acknowledged || values.decision === 'uncertain') return
    const result = await onSave(attempt, {
      expectedDigest: plan.digest,
      versionName: values.versionName,
      buildNumber: values.buildNumber,
      decision: values.decision,
      acknowledged: true,
    })
    if (result) onClose()
  }
  const s = plan?.snapshot
  return (
    <Modal
      title="记录人工核对结果"
      open={open && !!attempt}
      onCancel={onClose}
      okText="保存核对结论"
      cancelText="暂不处理"
      confirmLoading={disabled}
      okButtonProps={{
        disabled: disabled || !acknowledged || !decision || decision === 'uncertain',
      }}
      onOk={() => form.submit()}
    >
      <p>
        请先在商店后台核对 App ID {s?.binding.appId}，版本 {s?.artifact.identity?.versionName}
        ，构建号 {s?.artifact.identity?.buildNumber}。
      </p>
      {error && (
        <Alert role="alert" type="error" showIcon title={error} className="form-feedback" />
      )}
      <Form form={form} layout="vertical" onFinish={save}>
        <Form.Item
          name="decision"
          label="商店核对结论"
          rules={[{ required: true, message: '请选择核对结论' }]}
        >
          <Radio.Group
            options={[
              { value: 'draft_present', label: '草稿已存在，已核对版本与安装包' },
              { value: 'no_draft', label: '未保存，并确认没有处理中上传任务' },
              { value: 'uncertain', label: '仍不确定，继续保留阻塞' },
            ]}
          />
        </Form.Item>
        <Form.Item
          name="versionName"
          label="已核对的版本号"
          rules={[
            { required: true, message: '请输入在商店核对的版本号' },
            {
              validator: (_, value) =>
                value === s?.artifact.identity?.versionName
                  ? Promise.resolve()
                  : Promise.reject(new Error('版本号须与原计划一致')),
            },
          ]}
        >
          <Input aria-label="已核对的版本号" autoComplete="off" />
        </Form.Item>
        <Form.Item
          name="buildNumber"
          label="已核对的构建号"
          rules={[
            { required: true, message: '请输入在商店核对的构建号' },
            {
              validator: (_, value) =>
                value === s?.artifact.identity?.buildNumber
                  ? Promise.resolve()
                  : Promise.reject(new Error('构建号须与原计划一致')),
            },
          ]}
        >
          <Input aria-label="已核对的构建号" autoComplete="off" />
        </Form.Item>
        <Form.Item name="acknowledged" valuePropName="checked">
          <Checkbox>我已在商店后台核对目标、版本与处理中任务；本次记录不会触发上传</Checkbox>
        </Form.Item>
      </Form>
    </Modal>
  )
}
