/** @description 商店绑定查询列表；桌面表格与手机卡片共用动作，避免窄屏必须横向滚动。 */
import { Button, Card, Flex, Grid, List, Space, Table, Tag, Typography } from 'antd'
import {
  channelLabels,
  type StoreStatusSnapshot,
  type StoreStatusTarget,
} from '@release-harbor/contracts'
import { storeStatusLabel } from './storeStatusPresentation.ts'
import { StoreVersionTag } from './StoreVersionTag.tsx'

function status(target: StoreStatusTarget, snapshots: StoreStatusSnapshot[]) {
  // 1. 查询失败与审核拒绝是不同事实，不能借上次成功状态掩盖本次失败。
  const snapshot = snapshots.find((item) => item.bindingId === target.bindingId)
  const fallback = !target.querySupported
    ? '查询尚未开放'
    : !snapshot
      ? '待查询'
      : snapshot.code !== 'observed'
        ? '本次查询失败'
        : !snapshot.versions.length
          ? '官方暂无版本'
          : null
  if (fallback)
    return (
      <Tag
        className="store-version-status-tag"
        color={fallback === '本次查询失败' ? 'warning' : 'default'}
      >
        {fallback}
      </Tag>
    )
  // 2. 摘要按可见结论去重，完整版本仍在详情中；历史版本不重复堆叠相同标签。
  const seen = new Set<string>()
  const versions = snapshot?.versions
    .filter((version) => !['removed', 'superseded'].includes(version.state))
    .filter((version) => {
      const label = storeStatusLabel(target.channel, version)
      if (seen.has(label)) return false
      seen.add(label)
      return true
    })
  return (
    <Flex wrap gap={6} className="store-status-summary" aria-label="状态摘要">
      {!versions?.length && <Tag>仅有历史版本，查看详情</Tag>}
      {versions?.map((version) => (
        <StoreVersionTag
          key={storeStatusLabel(target.channel, version)}
          channel={target.channel}
          version={version}
        />
      ))}
    </Flex>
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
              <div className="store-status-card-summary">{status(item, snapshots)}</div>
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
        { title: '状态摘要', width: 200, render: (_, item) => status(item, snapshots) },
        { title: '操作', width: 250, render: (_, item) => actions(item) },
      ]}
    />
  )
}
