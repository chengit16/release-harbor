/** @description 批次渠道与 APK 分配；批量设置默认收起，公共默认值须显式应用，不支持策略不会静默降级。 */
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
  Tooltip,
  Typography,
} from 'antd'
import {
  batchChannels,
  channelLabels,
  type BatchTargetInput,
  type ChannelBinding,
  type ArtifactRecord,
  type ReleasePolicy,
} from '@release-harbor/contracts'
import { BatchCommonSettings } from './BatchCommonSettings.tsx'
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
      status={r.selected && !r.artifactId ? 'warning' : undefined}
      onChange={(artifactId) => patch(r.binding.id, { artifactId })}
      style={{ width: '100%' }}
      options={packages.map((a) => ({
        value: a.id,
        label: `${a.fileName} · ${a.identity?.versionName} (${a.identity?.buildNumber})`,
      }))}
    />
  )
  const rowInfo = (r: Row) => (
    <Space orientation="vertical" size={4} style={{ width: '100%', minWidth: 0 }}>
      <Tooltip title={r.notes || '点击编辑填写本渠道更新说明'}>
        <Typography.Text type={r.selected && !r.notes.trim() ? 'warning' : 'secondary'}>
          {r.notes.trim() ? '已填写说明' : '待填写说明'}
        </Typography.Text>
      </Tooltip>
      <Tag
        color={r.binding.channel === 'meizu' && r.policy.mode === 'scheduled' ? 'error' : undefined}
        style={{ whiteSpace: 'normal', marginInlineEnd: 0 }}
      >
        {r.policy.mode === 'scheduled'
          ? new Date(r.policy.notBefore).toLocaleString()
          : '审核通过后立即上架'}
        {r.binding.channel === 'huawei' ? ' · 仅记录意图' : ''}
      </Tag>
      {r.binding.channel === 'meizu' && r.policy.mode === 'scheduled' && (
        <Typography.Text type="danger">不支持定时，请编辑或取消选择</Typography.Text>
      )}
    </Space>
  )
  const adjust = (r: Row) => (
    <Button
      disabled={disabled}
      aria-label={`编辑${channelLabels[r.binding.channel]}发布内容`}
      onClick={() => {
        setEditing(r.binding.id)
        rowForm.resetFields()
        rowForm.setFieldsValue({ notes: r.notes, releaseMode: r.policy.mode })
      }}
    >
      编辑
    </Button>
  )
  return (
    <Flex vertical gap={12} style={{ width: '100%', minWidth: 0 }}>
      <div className="release-batch-toolbar">
        <Space wrap>
          <Typography.Text strong>选择渠道</Typography.Text>
          <Typography.Text type="secondary">
            {selected.length} / {rows.length} 个渠道
          </Typography.Text>
        </Space>
        <Checkbox
          disabled={disabled || !rows.length}
          checked={!!rows.length && selected.length === rows.length}
          indeterminate={selected.length > 0 && selected.length < rows.length}
          onChange={(e) => setRows((old) => old.map((r) => ({ ...r, selected: e.target.checked })))}
        >
          选择全部
        </Checkbox>
      </div>
      <Typography.Text type="secondary">
        选择 APK 并按需编辑渠道内容；未绑定渠道请先到“商店绑定”添加。
      </Typography.Text>
      <BatchCommonSettings
        artifacts={packages}
        selectedCount={selected.length}
        disabled={disabled}
        onApply={(values) => {
          // 批量应用是显式覆盖，仅影响当时已选行；后选渠道不自动继承。
          setRows((old) =>
            old.map((r) =>
              r.selected
                ? {
                    ...r,
                    artifactId: values.artifactId ?? r.artifactId,
                    notes: values.notes ?? r.notes,
                    policy: values.policy,
                  }
                : r,
            ),
          )
          setError('')
        }}
      />
      <div
        aria-label="批次渠道分配"
        style={disabled ? { pointerEvents: 'none', opacity: 0.65 } : undefined}
      >
        {screens.lg ? (
          <Table<Row>
            size="middle"
            tableLayout="fixed"
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
                title: '渠道 / 应用',
                key: 'channel',
                width: '25%',
                render: (_, r) => (
                  <Space orientation="vertical" size={4} style={{ width: '100%', minWidth: 0 }}>
                    <Typography.Text strong>{channelLabels[r.binding.channel]}</Typography.Text>
                    {r.binding.channel === 'huawei' && <Tag>保存草稿</Tag>}
                    <Tooltip
                      title={`目标：${r.binding.appId}；账号引用：${r.binding.credentialReference}`}
                    >
                      <Typography.Text
                        type="secondary"
                        ellipsis
                        style={{ width: '100%', maxWidth: 160, overflowWrap: 'anywhere' }}
                      >
                        {r.binding.appId}
                      </Typography.Text>
                    </Tooltip>
                  </Space>
                ),
              },
              { title: '发布安装包', key: 'apk', render: (_, r) => artifactSelect(r) },
              { title: '说明与上架方式', key: 'policy', render: (_, r) => rowInfo(r) },
              { title: '操作', key: 'adjust', width: 80, render: (_, r) => adjust(r) },
            ]}
          />
        ) : (
          <Space orientation="vertical" size={10} style={{ width: '100%' }}>
            {rows.map((r) => (
              <Card
                size="small"
                key={r.binding.id}
                styles={{ body: { display: r.selected ? undefined : 'none' } }}
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
                  {r.binding.channel === 'huawei' && <Tag>本次仅保存草稿</Tag>}
                </Space>
              </Card>
            ))}
          </Space>
        )}
      </div>
      {error && <Alert type="warning" showIcon title={error} role="alert" />}
      <div className="release-batch-actions">
        <Space orientation="vertical" size={2}>
          <Typography.Text strong>已选 {selected.length} 个渠道</Typography.Text>
          <Typography.Text type="secondary">准备只做检查，核对摘要后再确认执行。</Typography.Text>
        </Space>
        <Button
          type="primary"
          disabled={disabled || !selected.length}
          onClick={() => void submit()}
        >
          准备 {selected.length} 个渠道
        </Button>
      </div>
      <Modal
        title={row ? `编辑${channelLabels[row.binding.channel]}发布内容` : ''}
        open={!!row}
        okButtonProps={{ disabled }}
        onCancel={() => setEditing('')}
        onOk={() => {
          void rowForm
            .validateFields()
            .then((v) => {
              const p = policy(v)
              if (row && p && !disabled) {
                patch(row.binding.id, { notes: v.notes, policy: p })
                setEditing('')
              }
            })
            .catch(() => undefined)
        }}
      >
        <Typography.Paragraph type="secondary" style={{ overflowWrap: 'anywhere' }}>
          目标：{row?.binding.appId}
          <br />
          账号引用：{row?.binding.credentialReference}
        </Typography.Paragraph>
        <Typography.Paragraph type="secondary">
          {row?.binding.channel === 'huawei'
            ? '本次仅保存华为草稿，不提交审核。'
            : '本次上传并提交渠道更新审核。'}
        </Typography.Paragraph>
        <Form name="batchChannelSettings" form={rowForm} layout="vertical" disabled={disabled}>
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
