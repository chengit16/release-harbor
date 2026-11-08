/** @description 紧凑账号行与独立维护详情；只呈现安全元数据，凭据维护仍使用原独立录入通道。 */
import { useState } from 'react'
import { Alert, Button, Card, Drawer, Tag, Typography } from 'antd'
import { channelLabels, type CredentialAccount } from '@release-harbor/contracts'
import { AccountActions } from './AccountActions.tsx'

/** 目录优先展示名称、渠道与本机保存事实；维护弹层不读取已保存秘密。 */
export function AccountRow({
  account,
  onChanged,
}: {
  /** 服务端公开目录项。 */ account: CredentialAccount
  /** 真实操作后刷新目录及反馈。 */ onChanged: (feedback?: {
    text: string
    warning: boolean
  }) => void
}) {
  const [open, setOpen] = useState(false)
  const [feedback, setFeedback] = useState<{ text: string; warning: boolean }>()
  return (
    <>
      <Card size="small">
        <div className="account-row">
          <div>
            <h3 className="account-card-title">{account.displayName}</h3>
            <Typography.Text type="secondary">
              {channelLabels[account.channel]} · 关联 {account.applicationCount} 个应用
            </Typography.Text>
          </div>
          <div className="account-row-status">
            <Tag
              color={
                account.needsReconciliation ? 'warning' : account.configured ? 'success' : 'default'
              }
            >
              {account.needsReconciliation
                ? '保存待核对'
                : account.configured
                  ? '本机材料已保存'
                  : '配置未完成'}
            </Tag>
            {account.legacy && <Tag>已有档案</Tag>}
          </div>
          <Button onClick={() => setOpen(true)} aria-label={`维护账号 ${account.displayName}`}>
            维护账号
          </Button>
        </div>
      </Card>
      <Drawer
        title="账号维护"
        closable={{ 'aria-label': '关闭账号维护' }}
        open={open}
        onClose={() => setOpen(false)}
        size="large"
        styles={{ wrapper: { maxWidth: '100vw' } }}
        destroyOnHidden
      >
        <div className="account-detail">
          <Typography.Text strong>{account.displayName}</Typography.Text>
          <Typography.Text>
            {channelLabels[account.channel]} · 关联 {account.applicationCount} 个应用
          </Typography.Text>
          <Alert
            type={account.needsReconciliation ? 'warning' : 'info'}
            showIcon
            title={
              account.needsReconciliation
                ? '保存结果尚未确认，请先检查本机材料'
                : '本机材料保存与商店权限分别核对'
            }
            description="本机检查不连接商店；远端鉴权、应用身份及上传权限将在发布前检查中核对。"
          />
          {feedback && (
            <Alert
              role="status"
              type={feedback.warning ? 'warning' : 'success'}
              showIcon
              title={feedback.text}
            />
          )}
          <AccountActions
            account={account}
            onChanged={(notice) => {
              if (notice) setFeedback(notice)
              onChanged(notice)
            }}
          />
          <Typography.Text type="secondary">公开诊断引用</Typography.Text>
          <Typography.Text code>{account.reference}</Typography.Text>
        </div>
      </Drawer>
    </>
  )
}
