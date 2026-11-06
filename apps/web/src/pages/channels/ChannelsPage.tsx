/** @description 商店接入指南，只展示公开的适配范围，区分工程接入、用户后台反馈与待验收。 */
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
    <Card title="商店接入能力" extra={<Tag color="green">第三期 · 状态查询</Tag>}>
      <Alert
        type="info"
        showIcon
        className="form-feedback"
        title="发布入口已统一到发布中心。第三期首片支持荣耀已执行版本的手动状态查询：打开发布摘要或执行详情，点击“查询荣耀状态”。小米官方暂未开放审核状态查询，继续显示原提交回执。"
      />
      <Alert
        type="info"
        showIcon
        className="form-feedback"
        title="审核通过与已上架分别核对"
        description="观察记录显示来源与查询时间，页面刷新只读取本机历史。荣耀审核未通过时到后台查看具体意见；其他渠道的审核状态与资料待办按后续切片接入。"
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
