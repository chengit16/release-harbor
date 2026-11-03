/** @description 商店配置表单，失败保留草稿，冲突后显式核对新版本；不接收秘密。 */
import { useState } from 'react'
import { Alert, Button, Form, Input } from 'antd'
import type { Application, ChannelBinding } from '@release-harbor/contracts'
import { createBinding, updateBinding } from '../../api/services/applications.ts'
import { useSubmission } from '../../hooks/useSubmission.ts'

/** 绑定表单的当前安全上下文。 */
export interface BindingFormProps {
  /** 平台决定可配置渠道，服务端仍独立检查。 */
  application: Application
  /** 最新已读取配置；null 表示新建，刷新不会覆盖用户草稿。 */
  binding: ChannelBinding | null
  /** 关闭表单并恢复入口焦点。 */
  onCancel: () => void
  /** 成功后刷新事实并关闭编辑。 */
  onSaved: () => void
  /** 只刷新已保存配置，不自动提交或重置草稿。 */
  onRefresh: () => void
}

type BindingValues = Pick<ChannelBinding, 'appId' | 'credentialReference'>

/** 使用 Form 的初始值保留编辑草稿，版本变化由用户核对后采用。 */
export function BindingForm({
  application,
  binding,
  onCancel,
  onSaved,
  onRefresh,
}: BindingFormProps) {
  const { saving, error, submit } = useSubmission()
  const [expectedRevision, setExpectedRevision] = useState(binding?.revision ?? 0)
  const channel = application.platform === 'android' ? 'huawei' : 'app_store'
  const hasNewVersion = binding && binding.revision !== expectedRevision
  function handleSubmit(values: BindingValues): void {
    void submit(
      (signal) =>
        binding
          ? updateBinding(
              application.projectId,
              application.id,
              binding.id,
              { ...values, expectedRevision },
              signal,
            )
          : createBinding(application.projectId, application.id, { ...values, channel }, signal),
      onSaved,
    )
  }
  return (
    <section className="form-panel" aria-labelledby="binding-form-title">
      <div className="section-title">
        <h3 id="binding-form-title">{binding ? '编辑商店绑定' : '建立商店绑定'}</h3>
        <Button type="text" disabled={saving} onClick={onCancel}>
          取消
        </Button>
      </div>
      <p className="binding-explanation">
        {channel === 'huawei' ? '华为 AppGallery' : 'Apple App Store'} · 仅保存目标配置，发布待实现
      </p>
      <Form<BindingValues>
        name="binding"
        layout="vertical"
        disabled={saving}
        initialValues={binding ?? {}}
        onFinish={handleSubmit}
      >
        <Form.Item
          label="商店 appId"
          name="appId"
          extra="填写商店后台的应用标识，与包名／Bundle ID 分开管理。"
          rules={[{ required: true, whitespace: true, max: 128 }]}
        >
          <Input maxLength={128} spellCheck={false} />
        </Form.Item>
        <Form.Item
          label="凭据引用"
          name="credentialReference"
          extra="只填公开别名，不填密码、Token、JSON 或文件路径。"
          rules={[{ required: true, whitespace: true, max: 64 }]}
        >
          <Input maxLength={64} placeholder="例如：huawei-work" spellCheck={false} />
        </Form.Item>
        {error && (
          <Alert
            role="alert"
            type="error"
            title={error}
            showIcon
            className="form-feedback"
            action={
              binding && (
                <Button size="small" disabled={saving} onClick={onRefresh}>
                  刷新当前配置
                </Button>
              )
            }
          />
        )}
        {hasNewVersion && (
          <div className="version-conflict" role="status">
            <p>
              当前已保存版本 {binding.revision}：appId {binding.appId}，凭据引用{' '}
              {binding.credentialReference}。本地输入已保留。
            </p>
            <Button disabled={saving} onClick={() => setExpectedRevision(binding.revision)}>
              已核对，使用版本 {binding.revision}
            </Button>
          </div>
        )}
        <div className="form-bottom">
          <span>凭据未预检 · 保存不会发起商店操作</span>
          <Button
            htmlType="submit"
            type="primary"
            loading={saving}
            disabled={Boolean(hasNewVersion)}
          >
            保存绑定
          </Button>
        </div>
      </Form>
    </section>
  )
}
