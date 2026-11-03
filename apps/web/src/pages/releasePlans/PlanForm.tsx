/** @description 本次发布意图草稿，冻结前可编辑；提交只引用当前通过预检，不复制服务端快照。 */
import { useRef } from 'react'
import { Alert, Button, Form, Input, Select } from 'antd'
import {
  releaseActions,
  type Application,
  type CreateReleasePlan,
  type PreflightView,
  type ReleasePlan,
} from '@release-harbor/contracts'

/** 草稿只在当前应用组件内保留。 */
export interface PlanFormProps {
  /** 不可变应用身份，用于限制首期动作。 */
  application: Application
  /** 查询得到的当前预检，不允许客户端声明通过。 */
  preflights: PreflightView[]
  /** 请求或刷新中禁止使用旧版本提交。 */
  disabled: boolean
  /** 冻结成功返回计划；失败保留输入与本次去重 ID。 */
  onFreeze: (input: CreateReleasePlan) => Promise<ReleasePlan | null>
  /** 成功后打开只读快照，不自动确认。 */
  onFrozen: (plan: ReleasePlan) => void
}
/** 说明或预检变化视为新意图；同意图重试仍使用同请求 ID。 */
export function PlanForm({ application, preflights, disabled, onFreeze, onFrozen }: PlanFormProps) {
  const action = application.platform === 'android' ? 'huawei_save_draft' : 'apple_upload_build'
  const [form] = Form.useForm<{ preflightId: string; releaseNotes: string }>()
  const request = useRef({ key: '', id: '' })
  const candidates = preflights.filter((v) => v.current)
  async function submit(values: { preflightId: string; releaseNotes: string }): Promise<void> {
    const key = JSON.stringify([values.preflightId, action, values.releaseNotes.trim()])
    if (request.current.key !== key) request.current = { key, id: crypto.randomUUID() }
    const plan = await onFreeze({
      requestId: request.current.id,
      preflightId: values.preflightId,
      action,
      releaseNotes: values.releaseNotes.trim(),
    })
    if (plan) onFrozen(plan)
  }
  return (
    <Form form={form} layout="vertical" onFinish={submit} disabled={disabled}>
      {!candidates.length && (
        <Alert
          type="warning"
          showIcon
          title="暂无可用预检"
          description="请先在“只读预检”中完成一次通过的核验，再回到此处重新读取。预检有效期为五分钟。"
          className="form-feedback"
        />
      )}
      <Form.Item
        label="用于冻结的预检"
        name="preflightId"
        rules={[{ required: true, message: '请选择当前通过的预检' }]}
      >
        <Select
          aria-label="用于冻结的预检"
          placeholder="选择当前通过且未过期的预检"
          options={candidates.map((v) => ({
            value: v.record.id,
            label: `${new Date(v.record.checkedAt ?? v.record.createdAt).toLocaleString()} · 产物 ${v.record.artifactSha256.slice(0, 12)} · 绑定 v${v.record.bindingRevision}`,
          }))}
        />
      </Form.Item>
      <Form.Item label="计划动作">
        <Input value={releaseActions[action]} readOnly />
      </Form.Item>
      <Form.Item
        label="更新说明"
        name="releaseNotes"
        rules={[
          { required: true, whitespace: true, message: '请填写本次更新说明' },
          { max: 4000, message: '更新说明最多 4000 字' },
        ]}
      >
        <Input.TextArea
          aria-label="更新说明"
          rows={4}
          maxLength={4000}
          showCount
          placeholder="写明本次版本的更新内容，冻结后修改需建立新计划"
        />
      </Form.Item>
      <Button type="primary" htmlType="submit" disabled={disabled || !candidates.length}>
        冻结计划并复核
      </Button>
    </Form>
  )
}
