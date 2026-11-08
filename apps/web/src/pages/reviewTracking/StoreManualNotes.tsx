/** @description 小米人工核对表单与历史；本机追加事实，不冒称官方查询，失败保留表单和幂等请求。 */
import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Form, Input, List, Select, Space, Tag, Typography } from 'antd'
import {
  manualReviewStates,
  type StoreManualInput,
  type StoreManualRecord,
  type StoreStatusTarget,
} from '@release-harbor/contracts'
import { StoreVersionTag } from './StoreVersionTag.tsx'
import { saveStoreManualRecord } from '../../api/services/storeStatus.ts'

/** 绑定切换时由父级 key 重建；保存成功仅请求刷新目录，不执行商店动作。 */
export function StoreManualNotes({
  target,
  records,
  onSaved,
}: {
  /** 当前小米绑定，目标不可由表单覆盖。 */
  target: StoreStatusTarget
  /** 当前绑定下的人工历史，最新保存优先。 */
  records: StoreManualRecord[]
  /** 保存后只读刷新缓存。 */
  onSaved: () => void
}) {
  const [form] = Form.useForm()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const active = useRef<AbortController | null>(null)
  const retry = useRef<{ signature: string; input: StoreManualInput } | null>(null)
  useEffect(() => () => active.current?.abort(), [])

  async function save(values: {
    versionName: string
    buildNumber?: string
    state: StoreManualInput['state']
    checkedAt: string
    note?: string
  }) {
    // 1. 校验后的表单固定请求编号，网络失败后的相同重试不生成重复记录。
    if (active.current) return
    const signature = JSON.stringify(values)
    const input: StoreManualInput =
      retry.current?.signature === signature
        ? retry.current.input
        : {
            requestId: crypto.randomUUID(),
            versionName: values.versionName.trim(),
            buildNumber: values.buildNumber?.trim() || null,
            state: values.state,
            checkedAt: new Date(values.checkedAt).toISOString(),
            note: values.note?.trim() || '',
          }
    // 重试相同表单沿用请求 ID；修改表单产生新的记录，原记录不能被无声改写。
    retry.current = { signature, input }
    // 2. 人工记录只写本机；卸载取消等待，不撤销服务端已接受的保存。
    const controller = new AbortController()
    active.current = controller
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      await saveStoreManualRecord(
        target.projectId,
        target.applicationId,
        target.bindingId,
        input,
        controller.signal,
      )
      if (!controller.signal.aborted) {
        // 3. 保存后重新读目录，清理表单并提示人工来源。
        setSaved(true)
        setOpen(false)
        form.resetFields()
        retry.current = null
        onSaved()
      }
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(reason instanceof Error ? reason.message : '记录保存失败')
    } finally {
      active.current = null
      if (!controller.signal.aborted) setSaving(false)
    }
  }

  return (
    <section aria-label="小米人工核对" className="store-tracking-section">
      <Typography.Title level={3} style={{ fontSize: 16 }}>
        人工核对记录
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        小米尚未开放审核进度接口。请在官方后台核对后记录版本与时间；此处记录保留人工来源。
      </Typography.Paragraph>
      {saved && <Alert type="success" showIcon role="status" title="人工核对已保存" />}
      {!open && (
        <Button
          onClick={() => {
            setSaved(false)
            setOpen(true)
          }}
        >
          添加人工核对
        </Button>
      )}
      {open && (
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => void save(values)}
          initialValues={{ state: 'in_review' }}
          disabled={saving}
        >
          {error && <Alert type="error" showIcon title={error} role="alert" />}
          <Form.Item
            name="versionName"
            label="核对版本"
            rules={[{ required: true, whitespace: true, max: 80 }]}
          >
            <Input maxLength={80} />
          </Form.Item>
          <Form.Item
            name="buildNumber"
            label="核对构建号（可选）"
            rules={[{ pattern: /^[1-9]\d{0,17}$/, message: '请填写正整数构建号' }]}
          >
            <Input inputMode="numeric" maxLength={18} />
          </Form.Item>
          <Form.Item name="state" label="后台状态" rules={[{ required: true }]}>
            <Select
              options={Object.entries(manualReviewStates).map(([value, label]) => ({
                value,
                label,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="checkedAt"
            label="实际核对时间（本机时区）"
            rules={[
              { required: true },
              {
                validator: (_, value) =>
                  !value || (Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.now())
                    ? Promise.resolve()
                    : Promise.reject(new Error('请填写不晚于当前的时间')),
              },
            ]}
          >
            <Input type="datetime-local" />
          </Form.Item>
          <Form.Item
            name="note"
            label="处理备注"
            extra="仅记录简短处理说明，请勿粘贴账号、密钥或原始审核材料。"
            rules={[{ max: 300 }]}
          >
            <Input maxLength={300} />
          </Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={saving}>
              保存人工记录
            </Button>
            <Button disabled={saving} onClick={() => setOpen(false)}>
              取消
            </Button>
          </Space>
        </Form>
      )}
      <List
        dataSource={records}
        pagination={{ pageSize: 5 }}
        locale={{ emptyText: '尚无人工核对记录' }}
        renderItem={(record) => (
          <List.Item key={record.requestId}>
            <List.Item.Meta
              title={
                <Space wrap>
                  <Tag>人工核对</Tag>
                  {record.versionName}
                  {record.buildNumber && ` · 构建号 ${record.buildNumber}`}
                  <StoreVersionTag
                    channel="xiaomi"
                    version={{
                      versionId: null,
                      versionName: record.versionName,
                      buildNumber: record.buildNumber,
                      state: record.state,
                      rawState: null,
                    }}
                    manual
                  />
                </Space>
              }
              description={
                <>
                  <div>{new Date(record.checkedAt).toLocaleString()}（非实时）</div>
                  <div>{record.note || '未填写备注'}</div>
                </>
              }
            />
          </List.Item>
        )}
      />
    </section>
  )
}
