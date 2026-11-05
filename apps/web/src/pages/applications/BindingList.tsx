/** @description 商店绑定的安全元数据展示；桌面对齐比较，手机紧凑阅读，不推断预检或发布状态。 */
import type { ComponentRef, Ref } from 'react'
import { Button, Card, Descriptions, Table, Typography } from 'antd'
import {
  channelLabels,
  isPackageTargetChannel,
  type ChannelBinding,
  type CredentialAccount,
} from '@release-harbor/contracts'
import { useCompactLayout } from '../../app/useCompactLayout.ts'

/** 数据只来自当前应用的绑定与公开账号目录，不接触凭据材料。 */
export interface BindingListProps {
  /** 当前应用已保存的绑定，行标识使用稳定 ID。 */
  items: ChannelBinding[]
  /** 未读到目录时保持 undefined，不能伪装成账号已删除。 */
  accounts: CredentialAccount[] | undefined
  /** 目录加载与缺失分别表达。 */
  accountsLoading: boolean
  /** 明确点击才进入编辑，列表刷新不会写入配置。 */
  onEdit: (id: string) => void
  /** 返回编辑前所在行，避免焦点总是落到最后一个渠道。 */
  focusId: string | null
  /** 编辑区域卸载后绑定到原入口。 */
  focusRef: Ref<ComponentRef<typeof Button>>
}

/**
 * 同一组真实数据在不同宽度采用对应布局，隐藏的桌面／手机控件不会重复挂载。
 * 长函数保留原因：两个布局共享目标、账号与编辑单元格，集中保证信息及焦点一致；查询与编辑状态由父面板持有。
 */
export function BindingList({
  items,
  accounts,
  accountsLoading,
  onEdit,
  focusId,
  focusRef,
}: BindingListProps) {
  const compact = useCompactLayout()
  function target(item: ChannelBinding) {
    return (
      <div className="binding-target">
        <Typography.Text className="binding-field-label" type="secondary">
          {isPackageTargetChannel(item.channel) ? '目标包名' : '商店 App ID'}
        </Typography.Text>
        <Typography.Text copyable={{ text: item.appId }} className="binding-target-value">
          {item.appId}
        </Typography.Text>
      </div>
    )
  }
  function account(item: ChannelBinding) {
    const saved = accounts?.find(
      (a) => a.channel === item.channel && a.reference === item.credentialReference,
    )
    return (
      <Typography.Text type={saved ? undefined : 'secondary'} className="binding-account-name">
        {saved?.displayName ??
          (accountsLoading ? '正在读取账号…' : accounts ? '原账号待核对' : '账号目录暂不可用')}
      </Typography.Text>
    )
  }
  function edit(item: ChannelBinding) {
    return (
      <Button
        type="link"
        size="small"
        ref={focusId === item.id ? focusRef : undefined}
        onClick={() => onEdit(item.id)}
      >
        编辑绑定
      </Button>
    )
  }
  if (compact)
    return (
      <div className="binding-mobile-list">
        {items.map((item) => (
          <Card
            key={item.id}
            size="small"
            className="binding-card"
            title={<h4>{channelLabels[item.channel]}</h4>}
            extra={edit(item)}
          >
            <Descriptions
              size="small"
              column={1}
              items={[
                { key: 'target', label: '商店目标', children: target(item) },
                { key: 'account', label: '商店账号', children: account(item) },
                {
                  key: 'revision',
                  label: '配置版本',
                  children: <Typography.Text type="secondary">v{item.revision}</Typography.Text>,
                },
              ]}
            />
          </Card>
        ))}
      </div>
    )
  return (
    <Table<ChannelBinding>
      className="binding-table"
      rowKey="id"
      size="middle"
      tableLayout="fixed"
      pagination={false}
      dataSource={items}
      columns={[
        {
          title: '渠道',
          key: 'channel',
          width: '22%',
          render: (_, item) => (
            <div className="binding-channel">
              <strong>{channelLabels[item.channel]}</strong>
              <Typography.Text type="secondary" className="binding-version">
                配置 v{item.revision}
              </Typography.Text>
            </div>
          ),
        },
        { title: '商店目标', key: 'target', width: '36%', render: (_, item) => target(item) },
        { title: '商店账号', key: 'account', render: (_, item) => account(item) },
        {
          title: '操作',
          key: 'actions',
          width: 100,
          align: 'right',
          render: (_, item) => edit(item),
        },
      ]}
    />
  )
}
