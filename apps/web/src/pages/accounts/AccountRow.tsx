/** @description 商店账号卡片与独立维护详情；关联应用仅用公开投影，凭据维护沿用独立录入通道。 */
import { useState } from 'react'
import { Alert, Avatar, Button, Card, Drawer, Tag, Tooltip, Typography } from 'antd'
import { channelLabels, type CredentialAccount } from '@release-harbor/contracts'
import { updateUrlState, useUrlState } from '../../app/useUrlState.ts'
import { AccountActions } from './AccountActions.tsx'

const channelMarks = {
  huawei: '华',
  app_store: 'A',
  xiaomi: '米',
  oppo: 'O',
  vivo: 'V',
  meizu: '魅',
  honor: '荣',
  tencent: '宝',
  harmony: '鸿',
}

/** 目录优先展示名称、渠道与本机保存事实；维护弹层不读取已保存秘密。
 * 长函数保留原因：卡片与维护抽屉共享打开状态，独立操作已交给 AccountActions 管理。 */
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
  const open = useUrlState().get('accountDetail') === account.reference
  const setOpen = (value: boolean) =>
    updateUrlState({ accountDetail: value ? account.reference : '' })
  const [feedback, setFeedback] = useState<{ text: string; warning: boolean }>()
  const platform =
    account.channel === 'app_store'
      ? 'iOS'
      : account.channel === 'harmony'
        ? 'HarmonyOS'
        : 'Android'
  return (
    <>
      <Card
        size="small"
        className="credential-account-card"
        role="listitem"
        styles={{ body: { display: 'flex', flexDirection: 'column', height: '100%' } }}
      >
        <div className="account-card-main">
          <div className="account-provider">
            <Avatar shape="square" size={28} className="account-channel-mark" aria-hidden="true">
              {channelMarks[account.channel]}
            </Avatar>
            <Typography.Text type="secondary" className="account-provider-name">
              {channelLabels[account.channel]}
            </Typography.Text>
            <Typography.Text type="secondary" className="account-platform">
              {platform}
            </Typography.Text>
          </div>
          <h2 className="account-card-title">{account.displayName}</h2>
          <div className="account-applications">
            <Typography.Text type="secondary">关联应用</Typography.Text>
            {account.applications?.length ? (
              <>
                <Tooltip
                  title={`${account.applications[0]?.projectName} · ${account.applications[0]?.name}`}
                >
                  <Tag className="account-application-name">{account.applications[0]?.name}</Tag>
                </Tooltip>
                {account.applications.length > 1 && (
                  <Tooltip
                    title={account.applications
                      .slice(1)
                      .map((app) => `${app.projectName} · ${app.name}`)
                      .join('；')}
                  >
                    <Typography.Text type="secondary">
                      另 {account.applications.length - 1} 个
                    </Typography.Text>
                  </Tooltip>
                )}
              </>
            ) : (
              <Typography.Text type="secondary">
                {account.applicationCount ? `${account.applicationCount} 个应用` : '暂未关联'}
              </Typography.Text>
            )}
          </div>
        </div>
        <div className="account-card-footer">
          <div className="account-card-status">
            <Tag color={account.needsReconciliation || !account.configured ? 'warning' : 'default'}>
              {account.needsReconciliation
                ? '保存待核对'
                : account.configured
                  ? '凭据已保存'
                  : '待配置凭据'}
            </Tag>
            {account.legacy && <Tag>已有档案</Tag>}
          </div>
          <Button
            type="link"
            onClick={() => setOpen(true)}
            aria-label={`管理账号 ${account.displayName}`}
          >
            管理账号 →
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
          {account.applications?.map((application) => (
            <Typography.Text key={application.id} type="secondary">
              {application.projectName} · {application.name}
            </Typography.Text>
          ))}
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
