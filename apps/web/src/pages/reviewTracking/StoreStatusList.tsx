/** @description 商店绑定查询列表；桌面表格与手机卡片共用动作，避免窄屏必须横向滚动。 */
import { Button, Card, Grid, List, Space, Table, Tag, Typography } from 'antd'
import {
  channelLabels,
  type StoreStatusSnapshot,
  type StoreStatusTarget,
} from '@release-harbor/contracts'
import { storeStatusLabel } from './storeStatusPresentation.ts'

function status(target: StoreStatusTarget, snapshots: StoreStatusSnapshot[]): string {
  if (!target.querySupported) return '查询尚未开放'
  const snapshot = snapshots.find((item) => item.bindingId === target.bindingId)
  if (!snapshot) return '待查询'
  if (snapshot.code !== 'observed') return '本次查询失败'
  if (!snapshot.versions.length) return '官方暂无版本'
  return [...new Set(snapshot.versions.map((item) => storeStatusLabel(target.channel, item)))].join(
    '、',
  )
}

/** 表格只显示状态摘要，完整版本目录放在详情中，避免历史版本撑长行。 */
export function StoreStatusList({
  targets,
  snapshots,
  querying,
  onSelect,
  onQuery,
}: {
  /** 当前筛选后的可信商店绑定，不含凭据引用。 */
  targets: StoreStatusTarget[]
  /** 带原查询时间的缓存；列表只使用最近一次结果。 */
  snapshots: StoreStatusSnapshot[]
  /** 活动绑定 ID，非空时禁止其他绑定并行查询。 */
  querying: string
  /** 打开绑定详情，仅改变 URL，不访问商店。 */
  onSelect: (id: string) => void
  /** 用户明确点击后发起官方只读查询。 */
  onQuery: (item: StoreStatusTarget) => void
}) {
  const screens = Grid.useBreakpoint()
  const actions = (item: StoreStatusTarget) => (
    <Space wrap>
      <Button type="link" onClick={() => onSelect(item.bindingId)}>
        查看详情
      </Button>
      {item.querySupported && (
        <Button
          type="primary"
          ghost
          disabled={!!querying && querying !== item.bindingId}
          loading={querying === item.bindingId}
          onClick={() => onQuery(item)}
        >
          查询商店状态
        </Button>
      )}
    </Space>
  )
  const checked = (item: StoreStatusTarget) => {
    const snapshot = snapshots.find((entry) => entry.bindingId === item.bindingId)
    return snapshot ? `${new Date(snapshot.checkedAt).toLocaleString()}（非实时）` : '尚未查询'
  }
  if (!screens.lg)
    return (
      <List
        dataSource={targets}
        pagination={{ pageSize: 5 }}
        renderItem={(item) => (
          <List.Item>
            <Card
              size="small"
              style={{ width: '100%', minWidth: 0, overflowWrap: 'anywhere' }}
              title={item.applicationName}
              extra={<Tag>{channelLabels[item.channel]}</Tag>}
            >
              <Typography.Paragraph type="secondary">{item.identifier}</Typography.Paragraph>
              <Typography.Paragraph>{status(item, snapshots)}</Typography.Paragraph>
              <Typography.Paragraph type="secondary">{checked(item)}</Typography.Paragraph>
              {actions(item)}
            </Card>
          </List.Item>
        )}
      />
    )
  return (
    <Table
      rowKey="bindingId"
      dataSource={targets}
      pagination={{ pageSize: 10 }}
      scroll={{ x: 900 }}
      columns={[
        { title: '应用', dataIndex: 'applicationName' },
        { title: '商店', render: (_, item) => channelLabels[item.channel] },
        { title: '商店目标', dataIndex: 'appId', ellipsis: true },
        { title: '最近查询', render: (_, item) => checked(item) },
        { title: '状态摘要', render: (_, item) => status(item, snapshots) },
        { title: '操作', width: 250, render: (_, item) => actions(item) },
      ]}
    />
  )
}
