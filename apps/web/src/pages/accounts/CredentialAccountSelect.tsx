/** @description 绑定表单中的账号选择，按渠道过滤并支持页面新增；仅传播公开引用。 */
import { useEffect, useRef, useState, type ComponentRef } from 'react'
import { Alert, Button, Select, Space, Typography } from 'antd'
import type { BindingChannel } from '@release-harbor/contracts'
import { useCredentialAccounts } from './useCredentialAccounts.ts'
import { CredentialWizard } from './CredentialWizard.tsx'

/** 支持 Ant Design Form 注入 value／onChange，绑定草稿由原 Form 持有。 */
export interface CredentialAccountSelectProps {
  /** 应用平台已决定的商店渠道。 */
  channel: BindingChannel
  /** Form 注入的字段 ID，传给真实选择器以支持标签关联和首错定位。 */
  id?: string
  /** 已保存或用户刚选择的公开引用，不因刷新目录自动替换。 */
  value?: string
  /** 用户选择或新账号确认保存后触发，父 Form 决定何时保存绑定。 */
  onChange?: (reference: string) => void
  /** 父表单提交中禁止修改，避免变更提交快照。 */
  disabled?: boolean
}

/** 无效旧引用保留可见反馈，永不默选另一账号；向导退出后恢复原入口焦点。 */
export function CredentialAccountSelect({
  channel,
  id,
  value,
  onChange,
  disabled,
}: CredentialAccountSelectProps) {
  const { catalog, loading, error, refresh } = useCredentialAccounts()
  const [showWizard, setShowWizard] = useState(false)
  const trigger = useRef<ComponentRef<typeof Button>>(null)
  const wasOpen = useRef(false)
  useEffect(() => {
    if (wasOpen.current && !showWizard) trigger.current?.focus()
    wasOpen.current = showWizard
  }, [showWizard])
  const accounts = catalog?.accounts.filter((a) => a.channel === channel) ?? []
  const missing = Boolean(value && !accounts.some((a) => a.reference === value))
  const options = accounts.map((a) => ({
    value: a.reference,
    label: `${a.displayName}${a.needsReconciliation ? ' · 待核对' : !a.configured ? ' · 未完成' : ''}`,
    disabled: !a.configured || a.needsReconciliation,
  }))
  if (missing && value) options.push({ value, label: '原账号不可用，请重新选择', disabled: true })
  return (
    <Space orientation="vertical" style={{ width: '100%' }}>
      <Select
        id={id}
        showSearch
        optionFilterProp="label"
        aria-label="商店账号"
        value={value}
        onChange={onChange}
        options={options}
        placeholder={accounts.length ? '选择已配置的商店账号' : '尚无适用账号，请先新增'}
        loading={loading}
        disabled={disabled || loading || Boolean(error)}
        style={{ width: '100%' }}
      />
      <Space wrap>
        <Button
          ref={trigger}
          disabled={disabled || loading || catalog?.code !== 'available'}
          onClick={() => setShowWizard(true)}
        >
          新增账号
        </Button>
        {(error || missing) && (
          <Button type="link" disabled={disabled} onClick={refresh}>
            重新读取账号
          </Button>
        )}
      </Space>
      {error && <Alert role="alert" type="error" title={error} showIcon />}
      {catalog && catalog.code !== 'available' && (
        <Alert
          type="warning"
          showIcon
          title={
            catalog.code === 'unsupported_environment'
              ? '当前环境不支持 macOS 安全存储'
              : '账号目录暂不可用，请检查本机存储'
          }
        />
      )}
      {missing && !loading && (
        <Typography.Text type="warning">
          当前绑定的原账号不在可用目录中，请核对后重新选择。
        </Typography.Text>
      )}
      {showWizard && (
        <CredentialWizard
          channel={channel}
          onClose={() => {
            setShowWizard(false)
            refresh()
          }}
          onSaved={(reference) => {
            onChange?.(reference)
            setShowWizard(false)
            refresh()
          }}
        />
      )}
    </Space>
  )
}
