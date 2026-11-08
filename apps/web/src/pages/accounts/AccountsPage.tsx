/** @description 本机商店账号目录，提供按渠道新增及安全元数据查看，保存和应用预检分别表达。 */
import { channelLabels, isBindingChannel } from '@release-harbor/contracts'
import { useRef, useState, type ComponentRef } from 'react'
import { Alert, Button, Card, Empty, Select, Typography } from 'antd'
import type { BindingChannel } from '@release-harbor/contracts'
import { useCredentialAccounts } from './useCredentialAccounts.ts'
import { AccountRow } from './AccountRow.tsx'
import { CredentialWizard } from './CredentialWizard.tsx'

/**
 * 全局账号列表不接触已保存秘密；新建只回报公开引用，成功后重新读取事实。
 * 长函数保留原因：目录筛选、反馈及卡片保持相邻表达，录入与请求生命周期已拆分。
 */
export function AccountsPage() {
  // 1. 只筛选服务端安全目录，配置状态不能推导为商店鉴权结果。
  const { catalog, loading, error, refresh } = useCredentialAccounts()
  const channelOptions = [
    { label: '全部账号', value: 'all' },
    ...Object.entries(channelLabels).map(([value, label]) => ({ value, label })),
  ]
  function handleChannel(value: unknown): void {
    if (value === 'all' || isBindingChannel(value)) setChannel(value)
  }
  const [channel, setChannel] = useState<'all' | BindingChannel>('all')
  const [showWizard, setShowWizard] = useState(false)
  const [notice, setNotice] = useState('')
  const [warning, setWarning] = useState(false)
  const trigger = useRef<ComponentRef<typeof Button>>(null)
  const accounts = catalog?.accounts.filter((a) => channel === 'all' || a.channel === channel) ?? []
  function close(): void {
    // 2. 关闭与成功都重新读取事实，不把新账号插入为模拟成功数据。
    setShowWizard(false)
    refresh()
    trigger.current?.focus()
  }
  return (
    <section aria-label="商店账号管理" className="account-page">
      <div className="page-toolbar">
        <Typography.Text type="secondary">账号目录与维护</Typography.Text>
        <Button
          ref={trigger}
          type="primary"
          disabled={loading || catalog?.code !== 'available'}
          onClick={() => {
            setNotice('')
            setShowWizard(true)
          }}
        >
          新增商店账号
        </Button>
      </div>
      <div className="account-toolbar">
        <Select
          aria-label="账号渠道筛选"
          value={channel}
          options={channelOptions}
          onChange={handleChannel}
          style={{ width: '100%', maxWidth: 300 }}
        />
        <Button loading={loading} onClick={refresh}>
          重新读取账号
        </Button>
      </div>
      {notice && (
        <Alert
          className="form-feedback"
          type={warning ? 'warning' : 'success'}
          role="status"
          showIcon
          title={notice}
        />
      )}
      {error && (
        <Alert className="form-feedback" role="alert" type="error" title={error} showIcon />
      )}
      {catalog?.code !== 'available' && catalog && (
        <Alert
          className="form-feedback"
          type="warning"
          showIcon
          title={
            catalog.code === 'unsupported_environment'
              ? '当前环境暂不支持 macOS 安全存储'
              : '账号目录暂不可用，请检查本机存储'
          }
        />
      )}
      {!loading && !error && catalog?.code === 'available' && !accounts.length && (
        <Card>
          <Empty description="还没有商店账号，新增后即可在绑定中直接选择。" />
        </Card>
      )}
      <div className="credential-account-grid">
        {/* 3. 卡片仅展示名称、状态与公开引用，不提供已保存材料的读取入口。 */}
        {accounts.map((account) => (
          <AccountRow
            key={account.reference}
            account={account}
            onChanged={(feedback) => {
              refresh()
              if (feedback) {
                setNotice(feedback.text)
                setWarning(feedback.warning)
              }
            }}
          />
        ))}
      </div>
      {showWizard && (
        <CredentialWizard
          channel={channel === 'all' ? undefined : channel}
          onClose={close}
          onSaved={() => {
            close()
            setWarning(false)
            setNotice('账号已安全保存，尚未进行发布前检查。可返回应用的渠道配置选择此账号。')
          }}
        />
      )}
    </section>
  )
}
