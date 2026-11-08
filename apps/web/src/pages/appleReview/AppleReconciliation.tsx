/** @description Apple 未知审核／发布的人工核对；只附加声明，必须核对原版本与构建。 */
import { useEffect } from 'react'
import { Alert, Checkbox, Form, Input, Modal, Radio } from 'antd'
import type { AppleReviewRecord } from '@release-harbor/contracts'
/** 仅父组件选择的未知记录可操作。 */
export interface AppleReconciliationProps {
  /** 为空时关闭对话框。 */ record: AppleReviewRecord | undefined
  /** 保存期间禁止重复。 */ busy: boolean
  /** 服务端失败保留输入。 */ error: string
  /** 关闭不会重试。 */ onClose: () => void
  /** 仅提交用户核对的固定结论。 */ onSave: (
    r: AppleReviewRecord,
    body: unknown,
  ) => Promise<AppleReviewRecord | null>
}
/** 人工结论与自动观察分开，不能把后台缺少新上传当作没有审核提交。 */
export function AppleReconciliation({
  record: r,
  busy,
  error,
  onClose,
  onSave,
}: AppleReconciliationProps) {
  const [form] = Form.useForm()
  const ack = Form.useWatch('acknowledged', form)
  useEffect(() => form.resetFields(), [r?.id, form])
  return (
    <Modal
      title="核对 Apple 远端结果"
      open={!!r}
      onCancel={onClose}
      okText="保存核对结论"
      confirmLoading={busy}
      okButtonProps={{ disabled: !ack || busy }}
      onOk={() => form.submit()}
    >
      <Alert
        showIcon
        type="warning"
        title="先核对后台版本、构建、审核集合及处理中任务"
        description="确认没有执行且无处理中任务后，才可记录未执行；本次不会自动重试。"
      />
      {error && <Alert role="alert" showIcon type="error" title={error} />}
      <Form
        form={form}
        layout="vertical"
        scrollToFirstError={{ focus: true }}
        onFinish={async (v) => {
          if (r && (await onSave(r, v))) onClose()
        }}
      >
        <Form.Item name="decision" label="核对结论" rules={[{ required: true }]}>
          <Radio.Group
            options={[
              { value: 'present', label: '本次审核／发布操作已受理' },
              { value: 'absent', label: '未执行，且无处理中上传、审核或发布任务' },
            ]}
          />
        </Form.Item>
        <Form.Item
          name="version"
          label="已核对版本号"
          rules={[
            { required: true },
            {
              validator: (_, v) =>
                v === r?.snapshot.version.version
                  ? Promise.resolve()
                  : Promise.reject(Error('须匹配原版本')),
            },
          ]}
        >
          <Input />
        </Form.Item>
        <Form.Item
          name="build"
          label="已核对构建号"
          rules={[
            { required: true },
            {
              validator: (_, v) =>
                v === r?.snapshot.build.number
                  ? Promise.resolve()
                  : Promise.reject(Error('须匹配原构建')),
            },
          ]}
        >
          <Input />
        </Form.Item>
        <Form.Item name="acknowledged" valuePropName="checked">
          <Checkbox>我已在 Apple 后台核对，知晓这是人工声明且不会重试</Checkbox>
        </Form.Item>
      </Form>
    </Modal>
  )
}
