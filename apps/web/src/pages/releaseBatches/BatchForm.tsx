/** @description 批次渠道与 APK 分配；公共默认值须显式应用，逐行修改和不支持策略不会静默降级。 */
import { useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Form,
  Flex,
  Grid,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import {
  batchChannels,
  channelLabels,
  releaseActions,
  type BatchTargetInput,
  type ChannelBinding,
  type ArtifactRecord,
  type ReleasePolicy,
} from '@release-harbor/contracts'
import { ReleasePolicyFields } from '../releasePlans/ReleasePolicyFields.tsx'

type Row = {
  binding: ChannelBinding
  selected: boolean
  artifactId: string
  notes: string
  policy: ReleasePolicy
}
/** 当前应用加载的公开绑定和产物，不允许从本地路径构造执行输入。 */
export interface BatchFormProps {
  /** 仅当前应用的公开商店绑定，首版筛选既有 Android 渠道。 */
  bindings: ChannelBinding[]
  /** 已接收产物；只有 ready APK 可以选择。 */
  artifacts: ArtifactRecord[]
  /** 准备提交期间锁定配置；服务端仍独立验证。 */
  disabled: boolean
  /** 新草稿预选项，剩余项不包含已受理和待核对目标。 */
  initial?: BatchTargetInput[]
  /** 用户显式准备完整目标列表；不会自动确认。 */
  onPrepare: (targets: BatchTargetInput[]) => Promise<void>
}
/** 长函数保留原因：桌面和手机共享同一渠道分配状态，渲染分支与行编辑同属一个表单。
 * 桌面表格、窄屏卡片共享同一草稿；关闭行编辑不覆盖已选资料。 */
export function BatchForm({ bindings, artifacts, disabled, initial, onPrepare }: BatchFormProps) {
  // 1. 从当前草稿初始化，不以后台轮询覆盖正在填写的内容。
  const [rows, setRows] = useState<Row[]>(() =>
      bindings
        .filter((b) => batchChannels.some((c) => c === b.channel))
        .map((binding) => {
          const input = initial?.find((t) => t.bindingId === binding.id)
          return {
            binding,
            selected: !!input,
            artifactId: input?.artifactId ?? '',
            notes: input?.releaseNotes ?? '',
            policy: input?.releasePolicy ?? { mode: 'after_approval' },
          }
        }),
    ),
    [editing, setEditing] = useState(''),
    [error, setError] = useState(''),
    [form] = Form.useForm(),
    [rowForm] = Form.useForm(),
    screens = Grid.useBreakpoint()
  const packages = artifacts.filter((a) => a.status === 'ready' && a.format === 'apk'),
    selected = rows.filter((r) => r.selected),
    row = rows.find((r) => r.binding.id === editing)
  function patch(id: string, update: Partial<Row>) {
    setRows((old) => old.map((r) => (r.binding.id === id ? { ...r, ...update } : r)))
  }
  function policy(values: Record<string, unknown>): ReleasePolicy | null {
    if (values.releaseMode === 'after_approval') return { mode: 'after_approval' }
    const at = values.releaseAt
    if (
      values.releaseMode === 'scheduled' &&
      at &&
      typeof at === 'object' &&
      'toISOString' in at &&
      typeof at.toISOString === 'function'
    ) {
      return { mode: 'scheduled', notBefore: at.toISOString() }
    }
    return null
  }
  async function apply() {
    const v = await form.validateFields()
    const p = policy(v)
    if (!p) return
    setRows((old) =>
      old.map((r) =>
        r.selected
          ? { ...r, artifactId: v.artifactId ?? r.artifactId, notes: v.notes ?? r.notes, policy: p }
          : r,
      ),
    )
  }
  // 2. 全量检查已选行，不悄悄排除失败或不支持的策略。
  async function submit() {
    setError('')
    const targets: BatchTargetInput[] = []
    for (const r of selected) {
      const a = packages.find((a) => a.id === r.artifactId)
      if (!a?.sha256 || !r.notes.trim()) {
        setError('请为每个已选渠道分配安装包并填写更新说明')
        return
      }
      if (r.binding.channel === 'meizu' && r.policy.mode !== 'after_approval') {
        setError('魅族暂不支持指定时间，请在该行调整为立即上架或取消选择')
        return
      }
      targets.push({
        bindingId: r.binding.id,
        artifactId: a.id,
        expectedBindingRevision: r.binding.revision,
        expectedArtifactSha256: a.sha256,
        releaseNotes: r.notes.trim(),
        releasePolicy: r.policy,
      })
    }
    if (!targets.length) {
      setError('请至少选择一个渠道')
      return
    }
    await onPrepare(targets)
  }
  // 3. 不同布局复用同一行状态，禁用控件同时覆盖键盘与指针输入。
  const artifactSelect = (r: Row) => (
    <Select
      disabled={disabled}
      aria-label={`${channelLabels[r.binding.channel]}安装包`}
      value={r.artifactId || undefined}
      placeholder="选择已检查 APK"
      onChange={(artifactId) => patch(r.binding.id, { artifactId })}
      style={{ width: '100%', minWidth: 160 }}
      options={packages.map((a) => ({
        value: a.id,
        label: `${a.fileName} · ${a.identity?.versionName} (${a.identity?.buildNumber})`,
      }))}
    />
  )
  const rowInfo = (r: Row) => (
    <Space orientation="vertical" size={4}>
      <Typography.Text ellipsis style={{ maxWidth: 220 }}>
        {r.notes || '尚未填写说明'}
      </Typography.Text>
      <Tag
        color={r.binding.channel === 'meizu' && r.policy.mode === 'scheduled' ? 'error' : undefined}
      >
        {r.policy.mode === 'scheduled'
          ? new Date(r.policy.notBefore).toLocaleString()
          : '审核通过后立即上架'}
        {r.binding.channel === 'huawei' ? ' · 仅记录意图' : ''}
      </Tag>
    </Space>
  )
  const adjust = (r: Row) => (
    <Button
      disabled={disabled}
      onClick={() => {
        setEditing(r.binding.id)
        rowForm.resetFields()
        rowForm.setFieldsValue({ notes: r.notes, releaseMode: r.policy.mode })
      }}
    >
      调整
    </Button>
  )
  return (
    <Flex vertical gap={20} style={{ width: '100%', minWidth: 0 }}>
      <Card
        title="1. 选择渠道与分配安装包"
        extra={
          <Checkbox
            disabled={disabled || !rows.length}
            checked={!!rows.length && selected.length === rows.length}
            indeterminate={selected.length > 0 && selected.length < rows.length}
            onChange={(e) =>
              setRows((old) => old.map((r) => ({ ...r, selected: e.target.checked })))
            }
          >
            选择全部
          </Checkbox>
        }
      >
        <Typography.Paragraph type="secondary">
          同一 Android 应用、相同版本名称。可共用一个
          APK，也可分别选择渠道包。未绑定渠道请先到“商店绑定”添加。
        </Typography.Paragraph>
        <Form
          form={form}
          layout="vertical"
          initialValues={{ releaseMode: 'after_approval' }}
          disabled={disabled}
        >
          <Form.Item name="artifactId" label="通用安装包">
            <Select
              aria-label="批次通用安装包"
              placeholder="选择已检查 APK"
              options={packages.map((a) => ({
                value: a.id,
                label: `${a.fileName} · ${a.identity?.versionName} (${a.identity?.buildNumber})`,
              }))}
            />
          </Form.Item>
          <Form.Item name="notes" label="通用更新说明">
            <Input.TextArea aria-label="批次通用更新说明" rows={3} maxLength={4000} showCount />
          </Form.Item>
          <ReleasePolicyFields form={form} channel={undefined} />
          <Button
            onClick={() => void apply().catch(() => undefined)}
            disabled={disabled || !selected.length}
          >
            应用到已选渠道
          </Button>
        </Form>
      </Card>
      <div
        aria-label="批次渠道分配"
        style={disabled ? { pointerEvents: 'none', opacity: 0.65 } : undefined}
      >
        {screens.md ? (
          <Table<Row>
            rowKey={(r) => r.binding.id}
            dataSource={rows}
            pagination={false}
            rowSelection={{
              getCheckboxProps: () => ({ disabled }),
              selectedRowKeys: selected.map((r) => r.binding.id),
              onChange: (keys) =>
                setRows((old) => old.map((r) => ({ ...r, selected: keys.includes(r.binding.id) }))),
            }}
            columns={[
              {
                title: '渠道 / 目标',
                key: 'channel',
                width: 210,
                render: (_, r) => (
                  <Space orientation="vertical" size={2}>
                    <Typography.Text strong>{channelLabels[r.binding.channel]}</Typography.Text>
                    <Typography.Text type="secondary" style={{ overflowWrap: 'anywhere' }}>
                      {r.binding.appId}
                    </Typography.Text>
                    <Typography.Text type="secondary" style={{ overflowWrap: 'anywhere' }}>
                      账号：{r.binding.credentialReference}
                    </Typography.Text>
                    <Tag>
                      {r.binding.channel === 'huawei'
                        ? releaseActions.huawei_save_draft
                        : '更新提交'}
                    </Tag>
                  </Space>
                ),
              },
              { title: '发布安装包', key: 'apk', render: (_, r) => artifactSelect(r) },
              { title: '说明与上架方式', key: 'policy', render: (_, r) => rowInfo(r) },
              { title: '操作', key: 'adjust', width: 80, render: (_, r) => adjust(r) },
            ]}
          />
        ) : (
          <Space orientation="vertical" style={{ width: '100%' }}>
            {rows.map((r) => (
              <Card
                key={r.binding.id}
                title={
                  <Checkbox
                    disabled={disabled}
                    checked={r.selected}
                    onChange={(e) => patch(r.binding.id, { selected: e.target.checked })}
                  >
                    {channelLabels[r.binding.channel]}
                  </Checkbox>
                }
                extra={adjust(r)}
              >
                <Space orientation="vertical" style={{ width: '100%' }}>
                  <Typography.Text type="secondary" style={{ overflowWrap: 'anywhere' }}>
                    {r.binding.appId}
                  </Typography.Text>
                  {artifactSelect(r)}
                  {rowInfo(r)}
                </Space>
              </Card>
            ))}
          </Space>
        )}
      </div>
      {error && <Alert type="warning" showIcon title={error} role="alert" />}
      <Space wrap>
        <Button
          type="primary"
          disabled={disabled || !selected.length}
          onClick={() => void submit()}
        >
          准备 {selected.length} 个渠道
        </Button>
        <Typography.Text type="secondary">
          只读检查，不上传；全部就绪后核对一份摘要。
        </Typography.Text>
      </Space>
      <Modal
        title={row ? `调整${channelLabels[row.binding.channel]}发布内容` : ''}
        open={!!row}
        onCancel={() => setEditing('')}
        onOk={() => {
          void rowForm
            .validateFields()
            .then((v) => {
              const p = policy(v)
              if (row && p) {
                patch(row.binding.id, { notes: v.notes, policy: p })
                setEditing('')
              }
            })
            .catch(() => undefined)
        }}
      >
        <Form form={rowForm} layout="vertical">
          <Form.Item
            name="notes"
            label="本渠道更新说明"
            rules={[{ required: true, message: '请填写更新说明' }]}
          >
            <Input.TextArea rows={4} maxLength={4000} />
          </Form.Item>
          <ReleasePolicyFields form={rowForm} channel={row?.binding.channel} />
          {row?.policy.mode === 'scheduled' && (
            <Typography.Paragraph type="secondary">
              重新选择指定时间或明确改为立即上架，关闭不会修改原值。
            </Typography.Paragraph>
          )}
        </Form>
      </Modal>
    </Flex>
  )
}
