/** @description 本机商店账号目录，提供按渠道新增及安全元数据查看，保存和应用预检分别表达。 */
import { useRef, useState, type ComponentRef } from 'react'
import { Alert, Button, Card, Empty, Input, Select, Spin, Typography } from 'antd'
import { channelLabels, isBindingChannel, type BindingChannel } from '@release-harbor/contracts'
import { useCredentialAccounts } from './useCredentialAccounts.ts'
import { AccountRow } from './AccountRow.tsx'
import { CredentialWizard } from './CredentialWizard.tsx'
import { updateUrlState, useUrlState } from '../../app/useUrlState.ts'
import { workbenchPages } from '../../app/workbenchNavigation.tsx'

/**
 * 全局账号列表不接触已保存秘密；新建只回报公开引用，成功后重新读取事实。
 * 长函数保留原因：目录筛选、反馈及卡片保持相邻表达，录入与请求生命周期已拆分。
 */
export function AccountsPage() {
  // 1. 只筛选服务端安全目录，配置状态不能推导为商店鉴权结果。
  const { catalog, loading, error, refresh } = useCredentialAccounts()
  const channelOptions = [
    { label: '全部渠道', value: 'all' },
    ...Object.entries(channelLabels).map(([value, label]) => ({ value, label })),
  ]
  function handleChannel(value: unknown): void {
    if (value === 'all' || isBindingChannel(value))
      updateUrlState({ accountChannel: value === 'all' ? '' : value, accountDetail: '' })
  }
  const params = useUrlState()
  const candidate = params.get('accountChannel')
  const channel: 'all' | BindingChannel =
    candidate && isBindingChannel(candidate) ? candidate : 'all'
  const [query, setQuery] = useState('')
  const [showWizard, setShowWizard] = useState(false)
  const [notice, setNotice] = useState('')
  const [warning, setWarning] = useState(false)
  const trigger = useRef<ComponentRef<typeof Button>>(null)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const accounts =
    catalog?.accounts.filter(
      (account) =>
        (channel === 'all' || account.channel === channel) &&
        [
          account.displayName,
          channelLabels[account.channel],
          ...(account.applications?.flatMap((application) => [
            application.name,
            application.projectName,
          ]) ?? []),
        ]
          .join(' ')
          .toLocaleLowerCase()
          .includes(normalizedQuery),
    ) ?? []
  function close(): void {
    // 2. 关闭与成功都重新读取事实，不把新账号插入为模拟成功数据。
    setShowWizard(false)
    refresh()
    trigger.current?.focus()
  }
  return (
    <section aria-label="商店账号管理" className="account-page">
      <div className="page-heading account-heading">
        <div>
          <h1>{workbenchPages.accounts.title}</h1>
          <p className="subtitle">配置一次，在应用中选择复用。</p>
        </div>
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
        <Input
          aria-label="搜索账号或关联应用"
          placeholder="搜索账号、关联应用"
          allowClear
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="account-search"
        />
        <Select
          aria-label="账号渠道筛选"
          value={channel}
          options={channelOptions}
          onChange={handleChannel}
          className="account-channel-filter"
        />
        <Typography.Text type="secondary" className="account-count" role="status">
          {catalog?.code === 'available'
            ? `${accounts.length} 个账号`
            : loading
              ? '正在读取'
              : '目录暂不可用'}
        </Typography.Text>
        <Button loading={loading} onClick={refresh}>
          刷新列表
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
          <Empty
            description={
              catalog.accounts.length
                ? '没有匹配的账号，请调整搜索或渠道筛选。'
                : '还没有商店账号，新增后即可在渠道配置中直接选择。'
            }
          />
        </Card>
      )}
      {loading && (
        <div role="status" aria-label="正在读取账号">
          <Spin />
        </div>
      )}
      <div className="credential-account-grid" role="list" aria-label="商店账号">
        {/* 3. 关联名称来自公开目录，卡片与搜索均不读取已保存材料。 */}
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
      <Typography.Text type="secondary" className="account-safety-note">
        凭据仅保存在本机；已保存不代表商店鉴权通过。
      </Typography.Text>
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
