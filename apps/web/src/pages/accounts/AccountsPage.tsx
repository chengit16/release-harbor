/** @description 本机商店账号目录，提供按渠道新增及安全元数据查看，保存和应用预检分别表达。 */
import { channelLabels } from '@release-harbor/contracts'
import { useRef, useState, type ComponentRef } from 'react'
import { Alert, Button, Card, Collapse, Empty, Segmented, Space, Tag, Typography } from 'antd'
import type { BindingChannel } from '@release-harbor/contracts'
import { useCredentialAccounts } from './useCredentialAccounts.ts'
import { AccountActions } from './AccountActions.tsx'
import { CredentialWizard } from './CredentialWizard.tsx'

/**
 * 全局账号列表不接触已保存秘密；新建只回报公开引用，成功后重新读取事实。
 * 长函数保留原因：目录筛选、反馈及卡片保持相邻表达，录入与请求生命周期已拆分。
 */
export function AccountsPage() {
  // 1. 只筛选服务端安全目录，配置状态不能推导为商店鉴权结果。
  const { catalog, loading, error, refresh } = useCredentialAccounts()
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
    <section aria-label="商店账号管理">
      <Card className="account-intro-card">
        <div className="section-title">
          <div>
            <p className="eyebrow">LOCAL CREDENTIALS</p>
            <h2>商店账号</h2>
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
        <Typography.Paragraph className="binding-explanation">
          为华为、小米、OPPO 与 Apple
          配置本机发布凭据，在不同应用中选择复用。材料保存在本机安全存储，账号配置后仍需针对应用与安装包运行只读预检。
        </Typography.Paragraph>
        <Space wrap>
          <Tag>macOS Keychain</Tag>
          <Tag>文件加密保存</Tag>
          <Tag>不自动发布</Tag>
        </Space>
      </Card>
      <div className="account-toolbar">
        <Segmented
          aria-label="账号渠道筛选"
          value={channel}
          options={[
            { label: '全部账号', value: 'all' },
            { label: '华为', value: 'huawei' },
            { label: 'Apple', value: 'app_store' },
            { label: '小米', value: 'xiaomi' },
            { label: 'OPPO', value: 'oppo' },
            { label: 'vivo', value: 'vivo' },
          ]}
          onChange={(value) => {
            if (
              value === 'all' ||
              value === 'huawei' ||
              value === 'app_store' ||
              value === 'xiaomi' ||
              value === 'oppo' ||
              value === 'vivo'
            )
              setChannel(value)
          }}
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
          <Card
            key={account.reference}
            title={<h3 className="account-card-title">{account.displayName}</h3>}
            extra={<Tag>{channelLabels[account.channel]}</Tag>}
          >
            <Space wrap>
              <Tag
                color={
                  account.needsReconciliation
                    ? 'warning'
                    : account.configured
                      ? 'success'
                      : 'default'
                }
              >
                {account.needsReconciliation
                  ? '保存待核对'
                  : account.configured
                    ? '已配置 · 待应用预检'
                    : '配置未完成'}
              </Tag>
              {account.legacy && <Tag>已有档案</Tag>}
            </Space>
            <p className="binding-explanation">
              关联应用 <strong>{account.applicationCount}</strong> 个
            </p>
            {account.needsReconciliation && (
              <p className="binding-explanation">
                保存结果尚未确认，请先重新核对；材料缺失时可重新录入修复。
              </p>
            )}
            <Collapse
              size="small"
              ghost
              items={[
                {
                  key: 'reference',
                  label: '公开诊断信息',
                  children: (
                    <Typography.Text code style={{ overflowWrap: 'anywhere' }}>
                      {account.reference}
                    </Typography.Text>
                  ),
                },
              ]}
            />
            <AccountActions
              account={account}
              onChanged={(feedback) => {
                refresh()
                if (feedback) {
                  setNotice(feedback.text)
                  setWarning(feedback.warning)
                }
              }}
            />
          </Card>
        ))}
      </div>
      {showWizard && (
        <CredentialWizard
          channel={channel === 'all' ? undefined : channel}
          onClose={close}
          onSaved={() => {
            close()
            setWarning(false)
            setNotice('账号已安全保存，尚未进行应用预检。可返回商店绑定选择此账号。')
          }}
        />
      )}
    </section>
  )
}
