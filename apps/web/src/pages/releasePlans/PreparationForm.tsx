/** @description 日常发布内容表单；只提交准备请求，系统自动只读检查，用户不再手动选择预检或冻结。 */
import { useRef, type ReactNode } from 'react'
import { Alert, Button, Form, Input, Radio, Select, Typography } from 'antd'
import {
  isPackageTargetChannel,
  channelLabels,
  type ReleasePolicy,
  type ArtifactRecord,
  type ChannelBinding,
  type PrepareReleaseInput,
  type ReleasePreparation,
} from '@release-harbor/contracts'
import { ReleaseReuse } from './ReleaseReuse.tsx'
import { PreparationOverview } from './PreparationOverview.tsx'
import { ReleasePolicyFields } from './ReleasePolicyFields.tsx'

/** 表单草稿保留在当前应用内，选项全部来自公开服务端事实。 */
export interface PreparationFormProps {
  /** 仅当前应用的渠道绑定。 */
  bindings: ChannelBinding[]
  /** 与安装包选择同组的可选上传入口，不改变表单挂载或草稿。 */
  artifactIntake?: ReactNode
  /** 新发布入口固定已选择的渠道；省略时保留旧表单选择。 */
  selectedBindingId?: string
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
/** 同一草稿稳定请求编号，响应丢失后可以关联原进度，不自动重放请求。
 * 长函数保留原因：渠道字段、校验与表单订阅属于同一草稿；只读概览及上传已分离，避免拆分后重置输入。 */
export function PreparationForm({
  bindings,
  artifactIntake,
  selectedBindingId,
  artifacts,
  disabled,
  latest,
  onPrepare,
  onPrepared,
}: PreparationFormProps) {
  const [form] = Form.useForm<{
    bindingId: string
    huaweiAction?: 'save_draft' | 'submit_review'
    artifactId: string
    releaseNotes: string
    releaseMode: 'after_approval' | 'scheduled' | 'manual'
    releaseAt?: { toISOString(): string }
  }>()
  const huaweiAction = Form.useWatch('huaweiAction', form)
  const selectedBinding = Form.useWatch('bindingId', form)
  const artifactId = Form.useWatch('artifactId', form)
  const releaseMode = Form.useWatch('releaseMode', form)
  const channel = bindings.find((b) => b.id === selectedBinding)?.channel
  const intent = useRef({ key: '', id: '' })
  const ready = artifacts.filter((a) => a.status === 'ready' && a.sha256)
  const supported = selectedBindingId
    ? bindings.filter((item) => item.id === selectedBindingId)
    : bindings
  async function submit(values: {
    bindingId: string
    huaweiAction?: 'save_draft' | 'submit_review'
    artifactId: string
    releaseNotes: string
    releaseMode: 'after_approval' | 'scheduled' | 'manual'
    releaseAt?: { toISOString(): string }
  }): Promise<void> {
    // 1. 只从当前可选材料恢复真实目标，缺少未来时间或文件摘要时不准备。
    const binding = supported.find((b) => b.id === values.bindingId)
    const artifact = ready.find((a) => a.id === values.artifactId)
    if (!binding || !artifact?.sha256 || (values.releaseMode === 'scheduled' && !values.releaseAt))
      return
    const releasePolicy: ReleasePolicy =
      values.releaseMode === 'scheduled' && values.releaseAt
        ? { mode: 'scheduled', notBefore: values.releaseAt.toISOString() }
        : values.releaseMode === 'manual'
          ? { mode: 'manual' }
          : { mode: 'after_approval' }
    const content = {
      bindingId: binding.id,
      artifactId: artifact.id,
      expectedBindingRevision: binding.revision,
      expectedArtifactSha256: artifact.sha256,
      releaseNotes: values.releaseNotes.trim(),
      releasePolicy,
      ...(binding.channel === 'huawei' && values.huaweiAction === 'submit_review'
        ? { huaweiAction: 'submit_review' as const }
        : {}),
    }
    // 2. 相同未终结意图复用请求编号，响应丢失后不能创建第二次准备。
    const key = JSON.stringify(content)
    if (
      intent.current.key !== key ||
      (latest?.id === intent.current.id && latest.status !== 'checking')
    )
      intent.current = { key, id: crypto.randomUUID() }
    // 3. 只有服务端受理才定位准备结果，草稿和执行授权仍彼此独立。
    const result = await onPrepare({ requestId: intent.current.id, ...content })
    if (result) onPrepared(result.id)
  }
  return (
    <Form
      form={form}
      layout="vertical"
      onFinish={submit}
      scrollToFirstError={{ focus: true }}
      disabled={disabled}
      initialValues={{
        bindingId: selectedBindingId,
        releaseMode: 'after_approval',
        huaweiAction: 'save_draft',
      }}
    >
      <div className="release-form-grid">
        <div className="release-form-main">
          <ReleaseReuse
            bindings={supported}
            kind="single"
            disabled={disabled}
            getEntries={() => {
              const v = form.getFieldsValue()
              return v.bindingId && v.releaseNotes?.trim()
                ? [
                    {
                      bindingId: v.bindingId,
                      releaseNotes: v.releaseNotes.trim(),
                      mode: v.releaseMode,
                      huaweiAction: v.huaweiAction ?? 'save_draft',
                    },
                  ]
                : []
            }}
            onApply={(entries) => {
              const e = entries[0]
              if (!e) return
              form.resetFields()
              form.setFieldsValue({
                bindingId: selectedBindingId ?? e.bindingId,
                releaseNotes: e.releaseNotes,
                releaseMode: e.mode,
                huaweiAction: e.huaweiAction,
                artifactId: undefined,
                releaseAt: undefined,
              })
              intent.current = { key: '', id: '' }
            }}
          />
          {(!supported.length || !ready.length) && (
            <Alert
              className="form-feedback"
              type="info"
              showIcon
              title="请先完成基础配置"
              description="渠道尚未配置时请点击上方管理应用配置；缺少安装包时展开本页“上传新安装包”，上传并等待检查通过即可选择。"
            />
          )}
          <Form.Item
            hidden={!!selectedBindingId}
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
          {selectedBindingId && (
            <div className="release-package-section">
              <Typography.Text type="secondary">发布渠道</Typography.Text>
              <div className="release-readonly-target">
                {supported[0]
                  ? `${channelLabels[supported[0].channel]} · ${supported[0].appId}`
                  : '渠道配置已变化'}
              </div>
            </div>
          )}
          {channel === 'huawei' && (
            <Form.Item
              name="huaweiAction"
              label="发布动作"
              rules={[{ required: true, message: '请选择本次动作' }]}
            >
              <Radio.Group
                options={[
                  { value: 'save_draft', label: '保存草稿' },
                  { value: 'submit_review', label: '提交审核' },
                ]}
              />
            </Form.Item>
          )}
          <div className="release-package-section">{artifactIntake}</div>
          <Form.Item
            name="artifactId"
            label="发布安装包"
            rules={[{ required: true, message: '请选择检查通过的安装包' }]}
          >
            <Select
              aria-label="发布安装包"
              placeholder="选择检查通过的 APK／IPA／APP"
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
                  channel === 'huawei' &&
                  huaweiAction === 'submit_review' &&
                  typeof value === 'string' &&
                  value.trim().length > 1000
                    ? Promise.reject(new Error('华为更新说明最多 1000 字'))
                    : channel === 'honor' && typeof value === 'string' && value.trim().length > 500
                      ? Promise.reject(new Error('荣耀更新说明最多 500 字'))
                      : channel === 'vivo'
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
              maxLength={
                channel === 'vivo'
                  ? 200
                  : channel === 'honor'
                    ? 500
                    : channel === 'harmony' ||
                        (channel === 'huawei' && huaweiAction === 'submit_review')
                      ? 1000
                      : 4000
              }
              placeholder="填写本次版本更新内容"
            />
          </Form.Item>
          <ReleasePolicyFields
            form={form}
            channel={channel}
            huaweiSubmit={huaweiAction === 'submit_review'}
          />
          <Button
            type="primary"
            htmlType="submit"
            loading={disabled}
            disabled={disabled || !supported.length || !ready.length}
          >
            准备发布
          </Button>
        </div>
        <PreparationOverview
          binding={bindings.find((b) => b.id === selectedBinding)}
          artifact={ready.find((a) => a.id === artifactId)}
          mode={releaseMode}
          huaweiAction={huaweiAction}
        />
      </div>
    </Form>
  )
}
