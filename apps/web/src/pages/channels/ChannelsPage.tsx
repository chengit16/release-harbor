/** @description 渠道能力规划表，只展示公开的适配范围，未验收渠道均保持待接入。 */
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
  { title: '接入状态', key: 'status', render: () => <Tag>待接入</Tag> },
]

/** 使用表格比较目标动作，配置能力与真实执行能力分别表达。 */
export function ChannelsPage() {
  return (
    <Card title="渠道能力矩阵" extra={<Tag color="green">首批聚焦华为／Apple</Tag>}>
      <Alert
        type="info"
        showIcon
        className="form-feedback"
        title="当前支持首批商店的配置维护，上传、送审和上线待实现。"
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
        上游 SDK 的支持范围与产品已实现能力分别管理，真实渠道验收后再开放相应动作。
      </p>
    </Card>
  )
}
