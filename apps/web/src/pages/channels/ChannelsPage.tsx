/** @description 渠道能力规划表，只展示公开的适配范围，区分工程接入、用户后台反馈与待验收。 */
import { Alert, Card, Table, Tag } from 'antd'
import type { TableColumnsType } from 'antd'
import { channelCapabilities, type ChannelCapability } from '@release-harbor/contracts'

const columns: TableColumnsType<ChannelCapability> = [
  {
    title: '渠道',
    dataIndex: 'name',
    key: 'name',
    render: (name: string) => <h2 className="channel-table-title">{name}</h2>,
  },
  {
    title: '产物',
    dataIndex: 'artifact',
    key: 'artifact',
    render: (value: string) => <Tag>{value}</Tag>,
  },
  { title: '规划动作', dataIndex: 'plannedAction', key: 'action' },
  {
    title: '接入状态',
    key: 'status',
    render: (_, channel) => (
      <Tag
        color={
          channel.acceptance === 'user_confirmed'
            ? 'success'
            : channel.implemented
              ? 'processing'
              : 'default'
        }
      >
        {channel.acceptance === 'user_confirmed'
          ? '已接入 · 用户后台确认'
          : channel.implemented
            ? '工程已接入 · 待真实验收'
            : '待接入'}
      </Tag>
    ),
  },
]

/** 使用表格比较目标动作，配置能力与真实执行能力分别表达。 */
export function ChannelsPage() {
  return (
    <Card title="渠道能力矩阵" extra={<Tag color="green">逐个接入 Android</Tag>}>
      <Alert
        type="info"
        showIcon
        className="form-feedback"
        title="华为支持保存草稿，小米支持已有应用更新提交审核。Apple 暂缓；OPPO、vivo、魅族、荣耀按顺序接入。"
      />
      <Table<ChannelCapability>
        rowKey="id"
        columns={columns}
        dataSource={channelCapabilities}
        pagination={false}
        scroll={{ x: 600 }}
        size="middle"
      />
      <p className="capability-note">
        上游 SDK
        的支持范围与产品已实现能力分别管理，工程测试与真实渠道验收分别记录，提交审核不代表审核通过或上架。
      </p>
    </Card>
  )
}
