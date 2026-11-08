/** @description 单渠道与批次的配置复用工具；应用前确认覆盖，失败保留草稿，不自动准备或授权。 */
import { useEffect, useState } from 'react'
import { Alert, Button, Collapse, Flex, Input, Modal, Select, Typography } from 'antd'
import type { ChannelBinding, ReleasePreset, ReusableEntry } from '@release-harbor/contracts'
import {
  readReleasePresets,
  saveReleasePreset,
  deleteReleasePreset,
} from '../../api/services/localProductivity.ts'
/** 父表单提供最小可复用配置，安装包、时刻与授权不允许进入模板。 */
export interface ReleaseReuseProps {
  /** 已核对的当前应用绑定。 */ bindings: ChannelBinding[]
  /** 单渠道或批次分别筛选。 */ kind: 'single' | 'batch'
  /** 准备期间锁定复用操作。 */ disabled: boolean
  /** 获取当前说明和偏好；不调用发布接口。 */ getEntries: () => ReusableEntry[]
  /** 用户确认后覆盖草稿，必须清除原安装包与定时时间。 */ onApply: (
    entries: ReusableEntry[],
  ) => void
}
/** 模板与上次历史共用公开投影，切换应用后取消旧目录请求。 */
export function ReleaseReuse({ bindings, kind, disabled, getEntries, onApply }: ReleaseReuseProps) {
  // 1. 配置来源按应用隔离，取消旧请求后不覆盖当前目录。
  const p = bindings[0]?.projectId,
    a = bindings[0]?.applicationId
  const [items, setItems] = useState<ReleasePreset[]>([]),
    [selected, setSelected] = useState(''),
    [name, setName] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [confirm, setConfirm] = useState<'apply' | 'delete' | null>(null),
    [notice, setNotice] = useState('')
  useEffect(() => {
    if (!p || !a) return
    const c = new AbortController()
    void readReleasePresets(p, a, c.signal)
      .then((v) => {
        if (!c.signal.aborted) {
          setItems(v)
          setError('')
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e instanceof Error ? e.message : '复用配置读取失败')
      })
    return () => c.abort()
  }, [p, a, revision])
  const preset = items.find((v) => v.id === selected && v.kind === kind)
  // 2. 保存只提交字段白名单，不调用表单的发布提交函数。
  async function save() {
    if (!p || !a || busy) return
    setBusy(true)
    setError('')
    try {
      const entries = getEntries()
      if (!entries.length || !name.trim()) throw Error('请填写模板名称，并先选择渠道和填写更新说明')
      await saveReleasePreset(p, a, name.trim(), kind, entries)
      setName('')
      setRevision((n) => n + 1)
      setNotice('模板已保存，未准备或执行发布')
    } catch (e) {
      setError(e instanceof Error ? e.message : '模板未保存')
    } finally {
      setBusy(false)
    }
  }
  // 3. 用户确认覆盖后重新校验绑定存在，失败保留原草稿。
  async function act() {
    if (!p || !a || !preset) return
    setError('')
    if (confirm === 'apply') {
      if (preset.entries.some((e) => !bindings.some((b) => b.id === e.bindingId))) {
        setError('部分商店绑定已删除或变化，请重新选择渠道；当前草稿未修改')
        setConfirm(null)
        return
      }
      onApply(preset.entries)
      setConfirm(null)
      setNotice('已带入配置，请重新选择安装包；指定时间也需要重新填写。准备后仍须核对摘要确认。')
      return
    }
    setBusy(true)
    try {
      await deleteReleasePreset(p, a, preset.id)
      setSelected('')
      setRevision((n) => n + 1)
      setConfirm(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '模板未删除')
    } finally {
      setBusy(false)
    }
  }
  if (!p || !a) return null
  return (
    <>
      <Collapse
        size="small"
        className="form-feedback"
        items={[
          {
            key: 'reuse',
            label: '复用配置与常用模板',
            children: (
              <Flex vertical gap={12}>
                {error && <Alert role="alert" type="error" title={error} />}
                {notice && <Alert role="status" type="info" title={notice} />}
                <Typography.Text type="secondary">
                  复用渠道、更新说明及发布偏好，安装包和具体时间重新选择。不会复用旧检查、计划或授权。
                </Typography.Text>
                <Select
                  aria-label="选择复用配置"
                  placeholder="选择模板或历史配置"
                  value={selected || undefined}
                  onChange={setSelected}
                  disabled={disabled || busy}
                  options={items
                    .filter((v) => v.kind === kind)
                    .map((v) => ({
                      value: v.id,
                      label: `${v.source === 'template' ? '模板' : '历史'} · ${v.name}`,
                    }))}
                />
                <Flex wrap gap={8}>
                  <Button
                    disabled={disabled || busy || !preset}
                    onClick={() => setConfirm('apply')}
                  >
                    带入所选配置
                  </Button>
                  <Button
                    danger
                    disabled={disabled || busy || preset?.source !== 'template'}
                    onClick={() => setConfirm('delete')}
                  >
                    删除所选模板
                  </Button>
                  <Button disabled={busy} onClick={() => setRevision((n) => n + 1)}>
                    刷新配置来源
                  </Button>
                </Flex>
                <Input
                  aria-label="发布模板名称"
                  placeholder="模板名称，例如 Android 常规更新"
                  maxLength={80}
                  value={name}
                  disabled={disabled || busy}
                  onChange={(e) => setName(e.target.value)}
                />
                <Button disabled={disabled || busy} loading={busy} onClick={() => void save()}>
                  保存当前配置为模板
                </Button>
              </Flex>
            ),
          },
        ]}
      />
      <Modal
        title={confirm === 'delete' ? '确认删除模板' : '确认带入发布配置'}
        open={!!confirm}
        okText={confirm === 'delete' ? '删除模板' : '确认带入'}
        cancelText="取消"
        confirmLoading={busy}
        onCancel={() => {
          if (!busy) setConfirm(null)
        }}
        onOk={() => void act()}
      >
        <Typography.Paragraph>
          {confirm === 'delete'
            ? '删除仅影响此模板，历史发布记录保留。'
            : '将覆盖当前渠道、说明与发布偏好，并清空已选安装包和具体时间。当前草稿如需保留，请先保存模板。'}
        </Typography.Paragraph>
      </Modal>
    </>
  )
}
