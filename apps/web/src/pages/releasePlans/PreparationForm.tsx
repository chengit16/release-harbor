/** @description 日常发布内容表单；只提交准备请求，系统自动只读检查，用户不再手动选择预检或冻结。 */
import { isPackageTargetChannel } from '@release-harbor/contracts'

import { ReleasePolicyFields } from './ReleasePolicyFields.tsx'
import { channelLabels, type ReleasePolicy } from '@release-harbor/contracts'
import { useRef } from 'react'
import { Alert, Button, Form, Input, Select } from 'antd'
import type {
  ArtifactRecord,
  ChannelBinding,
  PrepareReleaseInput,
  ReleasePreparation,
} from '@release-harbor/contracts'

/** 表单草稿保留在当前应用内，选项全部来自公开服务端事实。 */
export interface PreparationFormProps {
  /** 仅当前应用的渠道绑定。 */
  bindings: ChannelBinding[]
  /** 已接收安装包，只有 ready 可选。 */
  artifacts: ArtifactRecord[]
  /** 加载、提交或准备中禁止重复受理新内容。 */
  disabled: boolean
  /** 已确认的终态允许用户显式重新准备相同内容，网络结果不明时仍复用原编号。 */
  latest: ReleasePreparation | undefined
  /** 服务端受理后后台检查，失败保留草稿。 */
  onPrepare: (input: PrepareReleaseInput) => Promise<ReleasePreparation | null>
  /** 记录本次准备编号，后续只轮询结果。 */
  onPrepared: (id: string) => void
}
/** 同一草稿稳定请求编号，响应丢失后可以关联原进度，不自动重放请求。 */
export function PreparationForm({
  bindings,
  artifacts,
  disabled,
  latest,
  onPrepare,
  onPrepared,
}: PreparationFormProps) {
  const [form] = Form.useForm<{
    bindingId: string
    artifactId: string
    releaseNotes: string
    releaseMode: 'after_approval' | 'scheduled'
    releaseAt?: { toISOString(): string }
  }>()
  const selectedBinding = Form.useWatch('bindingId', form)
  const channel = bindings.find((b) => b.id === selectedBinding)?.channel
  const intent = useRef({ key: '', id: '' })
  const ready = artifacts.filter((a) => a.status === 'ready' && a.sha256)
  const supported = bindings
  async function submit(values: {
    bindingId: string
    artifactId: string
    releaseNotes: string
    releaseMode: 'after_approval' | 'scheduled'
    releaseAt?: { toISOString(): string }
  }): Promise<void> {
    const binding = supported.find((b) => b.id === values.bindingId)
    const artifact = ready.find((a) => a.id === values.artifactId)
    if (!binding || !artifact?.sha256 || (values.releaseMode === 'scheduled' && !values.releaseAt))
      return
    const releasePolicy: ReleasePolicy =
      values.releaseMode === 'scheduled' && values.releaseAt
        ? { mode: 'scheduled', notBefore: values.releaseAt.toISOString() }
        : { mode: 'after_approval' }
    const content = {
      bindingId: binding.id,
      artifactId: artifact.id,
      expectedBindingRevision: binding.revision,
      expectedArtifactSha256: artifact.sha256,
      releaseNotes: values.releaseNotes.trim(),
      releasePolicy,
    }
    const key = JSON.stringify(content)
    if (
      intent.current.key !== key ||
      (latest?.id === intent.current.id && latest.status !== 'checking')
    )
      intent.current = { key, id: crypto.randomUUID() }
    const result = await onPrepare({ requestId: intent.current.id, ...content })
    if (result) onPrepared(result.id)
  }
  return (
    <Form
      form={form}
      layout="vertical"
      onFinish={submit}
      disabled={disabled}
      initialValues={{ releaseMode: 'after_approval' }}
    >
      {(!supported.length || !ready.length) && (
        <Alert
          className="form-feedback"
          type="info"
          showIcon
          title="请先完成基础配置"
          description="在商店绑定中选择对应渠道账号，并在安装包中上传、检查 APK／IPA。配置完成后点击重新读取。Apple 执行仍暂缓。"
        />
      )}
      <Form.Item
        name="bindingId"
        label="发布渠道"
        rules={[{ required: true, message: '请选择发布渠道' }]}
      >
        <Select
          aria-label="发布渠道"
          placeholder="选择已保存的商店绑定"
          options={supported.map((b) => ({
            value: b.id,
            label: `${channelLabels[b.channel]} · ${isPackageTargetChannel(b.channel) ? '包名' : 'App ID'} ${b.appId}`,
          }))}
        />
      </Form.Item>
      <Form.Item
        name="artifactId"
        label="发布安装包"
        rules={[{ required: true, message: '请选择检查通过的安装包' }]}
      >
        <Select
          aria-label="发布安装包"
          placeholder="选择检查通过的 APK／IPA"
          options={ready.map((a) => ({
            value: a.id,
            label: `${a.fileName} · ${a.identity?.versionName} (${a.identity?.buildNumber})`,
          }))}
        />
      </Form.Item>
      <Form.Item
        name="releaseNotes"
        label="更新说明"
        rules={[
          { required: true, whitespace: true, message: '请填写更新说明' },
          { max: 4000, message: '最多填写 4000 字' },
          {
            validator: (_, value) =>
              channel === 'vivo'
                ? typeof value === 'string' &&
                  Array.from(value.trim()).length >= 5 &&
                  Array.from(value.trim()).length <= 200
                  ? Promise.resolve()
                  : Promise.reject(new Error('vivo 更新说明须为 5–200 字'))
                : channel !== 'oppo' ||
                    (typeof value === 'string' && Array.from(value.trim()).length >= 5)
                  ? Promise.resolve()
                  : Promise.reject(new Error('OPPO 更新说明至少填写 5 个字')),
          },
        ]}
      >
        <Input.TextArea
          aria-label="更新说明"
          rows={4}
          showCount
          maxLength={channel === 'vivo' ? 200 : 4000}
          placeholder="填写本次版本更新内容"
        />
      </Form.Item>
      <ReleasePolicyFields form={form} channel={channel} />
      <Button
        type="primary"
        htmlType="submit"
        loading={disabled}
        disabled={disabled || !supported.length || !ready.length}
      >
        准备发布
      </Button>
    </Form>
  )
}
