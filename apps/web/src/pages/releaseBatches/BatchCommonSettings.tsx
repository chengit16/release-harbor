/**
 * @description 可折叠的批次公共设置；局部保留未应用输入，显式应用才修改父级已选渠道。
 * 收起不提交、不清空草稿；此组件不调用准备或远端接口。
 */
import { useRef, useState } from 'react'
import { Button, Collapse, Form, Input, Select, Space, Typography } from 'antd'
import type { ArtifactRecord, ReleasePolicy } from '@release-harbor/contracts'
import { focusFormError } from '../../utils/focusFormError.ts'
import { ReleasePolicyFields } from '../releasePlans/ReleasePolicyFields.tsx'

type Values = {
  artifactId?: string
  notes?: string
  releaseMode: 'after_approval' | 'scheduled'
  releaseAt?: { toISOString: () => string }
}

/** 只接收可公开选择的 APK 和当前选择数量，不自行持有渠道草稿。 */
export interface BatchCommonSettingsProps {
  /** 当前应用已经检查通过的 APK。 */
  artifacts: ArtifactRecord[]
  /** 本次点击应用会影响的渠道数量，未选择时禁止应用。 */
  selectedCount: number
  /** 准备期间锁定输入；不代替服务端校验。 */
  disabled: boolean
  /** 已通过表单校验的公共值；省略的包和说明保留各行现值，上架方式始终显式应用。 */
  onApply: (values: { artifactId?: string; notes?: string; policy: ReleasePolicy }) => void
}

/** 公共设置默认展开，按所选 APK 提供说明草稿；显式应用后收起，不自动准备。 */
export function BatchCommonSettings({
  artifacts,
  selectedCount,
  disabled,
  onApply,
}: BatchCommonSettingsProps) {
  const [form] = Form.useForm<Values>(),
    [expanded, setExpanded] = useState(true),
    [appliedCount, setAppliedCount] = useState(0),
    generatedNotes = useRef('旨在提升软件稳定性')

  function handleValuesChange(changed: Partial<Values>) {
    setAppliedCount(0)
    if (!Object.hasOwn(changed, 'artifactId')) return
    const currentNotes = form.getFieldValue('notes')
    // 仅替换仍沿用默认文案的草稿；手写内容（包括主动清空）由用户决定。
    if (currentNotes !== generatedNotes.current) return
    const version = artifacts.find((artifact) => artifact.id === changed.artifactId)?.identity
      ?.versionName
    generatedNotes.current = version
      ? `“${version}”更新说明\n旨在提升软件稳定性`
      : '旨在提升软件稳定性'
    form.setFieldValue('notes', generatedNotes.current)
  }

  async function apply() {
    if (disabled || !selectedCount) return
    const values = await form.validateFields()
    if (values.releaseMode === 'scheduled' && !values.releaseAt) return
    const policy: ReleasePolicy =
      values.releaseMode === 'scheduled' && values.releaseAt
        ? { mode: 'scheduled', notBefore: values.releaseAt.toISOString() }
        : { mode: 'after_approval' }
    onApply({ artifactId: values.artifactId, notes: values.notes, policy })
    setAppliedCount(selectedCount)
    setExpanded(false)
  }

  return (
    <Collapse
      size="small"
      activeKey={expanded ? ['settings'] : []}
      onChange={(keys) => setExpanded(keys.includes('settings'))}
      items={[
        {
          key: 'settings',
          label: (
            <Space wrap size={8}>
              <Typography.Text strong>批量设置</Typography.Text>
              <Typography.Text type="secondary">统一 APK、更新说明与上架方式</Typography.Text>
              {appliedCount > 0 && (
                <Typography.Text type="success" role="status">
                  上次应用：{appliedCount} 个渠道
                </Typography.Text>
              )}
            </Space>
          ),
          children: (
            <Form
              name="batchCommonSettings"
              form={form}
              layout="vertical"
              initialValues={{ releaseMode: 'after_approval', notes: '旨在提升软件稳定性' }}
              disabled={disabled}
              onValuesChange={handleValuesChange}
            >
              <div className="release-batch-common-fields">
                <Form.Item name="artifactId" label="通用安装包">
                  <Select
                    aria-label="批次通用安装包"
                    placeholder="不选则保留各渠道 APK"
                    allowClear
                    options={artifacts.map((a) => ({
                      value: a.id,
                      label: `${a.fileName} · ${a.identity?.versionName} (${a.identity?.buildNumber})`,
                    }))}
                  />
                </Form.Item>
                <Form.Item name="notes" label="通用更新说明">
                  <Input.TextArea
                    aria-label="批次通用更新说明"
                    placeholder="填写后应用到已选渠道"
                    rows={2}
                    maxLength={4000}
                    showCount
                  />
                </Form.Item>
              </div>
              <ReleasePolicyFields form={form} channel={undefined} />
              <Space wrap>
                <Button
                  onClick={() =>
                    void apply().catch((error: unknown) => focusFormError(form, error))
                  }
                  disabled={disabled || !selectedCount}
                >
                  应用到 {selectedCount} 个已选渠道
                </Button>
                <Typography.Text type="secondary">
                  覆盖已选渠道的对应设置，仍可逐行编辑。
                </Typography.Text>
              </Space>
            </Form>
          ),
        },
      ]}
    />
  )
}
