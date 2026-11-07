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
        title="发布入口已统一到发布中心。“审核状态 → 商店状态”直接从已绑定应用读取官方版本，无需先在本机发布，官网手动提交的版本也可查询。原执行和观察保留在“本地发布关联”。"
      />
      <Alert
        type="info"
        showIcon
        className="form-feedback"
        title="审核通过与已上架分别核对"
        description="魅族、荣耀、Apple、vivo、华为 Android 与鸿蒙支持已核实状态。应用宝分别展示审核流程和版本资料；OPPO 仅确认官方“上线”描述，其他阶段继续核对。小米显示公开在架版本，暂不提供审核进度。页面标记查询时间和范围，刷新只读本机缓存，资料待办继续推进。"
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
