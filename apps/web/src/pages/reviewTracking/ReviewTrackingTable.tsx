/** @description 审核状态独立列表，按渠道版本展示安全摘要；原回执、观察来源与待办分别呈现。 */
import { Button, Space, Table, Tag, Typography } from 'antd'
import { useCompactLayout } from '../../app/useCompactLayout.ts'
import { ReviewTrackingMobileList } from './ReviewTrackingMobileList.tsx'
import { reviewRecordLabel, reviewStateColor } from './reviewTrackingPresentation.ts'
import {
  channelLabels,
  reviewTrackingStates,
  reviewTrackingTodos,
  type ReviewTrackingItem,
} from '@release-harbor/contracts'
/** 分页和详情定位由父页 URL 维护。 */
interface Props {
  items: ReviewTrackingItem[]
  loading: boolean
  page: number
  onPage: (page: number) => void
  onSelect: (id: string) => void
}
/** 桌面为版本表格，窄屏滚动限定在卡片内部，不把整页撑宽。 */
export function ReviewTrackingTable({ items, loading, page, onPage, onSelect }: Props) {
  const compact = useCompactLayout()
  if (compact)
    return (
      <ReviewTrackingMobileList
        items={items}
        loading={loading}
        page={page}
        onPage={onPage}
        onSelect={onSelect}
      />
    )
  return (
    <Table<ReviewTrackingItem>
      rowKey={(item) => `${item.kind}:${item.id}`}
      dataSource={items}
      loading={loading}
      scroll={{ x: 1100 }}
      pagination={{
        current: page,
        pageSize: 10,
        showSizeChanger: false,
        hideOnSinglePage: true,
        onChange: onPage,
      }}
      columns={[
        {
          title: '应用 / 项目',
          width: 190,
          render: (_, item) => (
            <Space orientation="vertical" size={2}>
              <Typography.Text strong>{item.applicationName}</Typography.Text>
              <Typography.Text type="secondary">
                {item.projectName} ·{' '}
                {item.platform === 'ios'
                  ? 'iOS'
                  : item.platform === 'harmony'
                    ? 'HarmonyOS'
                    : 'Android'}
              </Typography.Text>
            </Space>
          ),
        },
        {
          title: '版本 / 渠道',
          width: 170,
          render: (_, item) => (
            <Space orientation="vertical" size={4}>
              <Typography.Text>
                {item.versionName} ({item.buildNumber})
              </Typography.Text>
              <Tag>{channelLabels[item.channel]}</Tag>
              <Typography.Text type="secondary">{reviewRecordLabel(item)}</Typography.Text>
            </Space>
          ),
        },
        {
          title: '审核状态',
          width: 155,
          render: (_, item) => (
            <Space orientation="vertical" size={4}>
              <Tag color={reviewStateColor(item.state)}>{reviewTrackingStates[item.state]}</Tag>
              {item.channel !== 'honor' && !item.appleObservation && (
                <Typography.Text type="secondary">
                  {item.channel === 'xiaomi'
                    ? '官方未开放查询'
                    : item.channel === 'app_store'
                      ? '可在发布工作区刷新'
                      : '查询能力待接入'}
                </Typography.Text>
              )}
            </Space>
          ),
        },
        {
          title: '查询时间 / 来源',
          width: 240,
          render: (_, item) => {
            const time = item.observation?.checkedAt ?? item.appleObservation?.checkedAt
            return time ? (
              <>
                <Typography.Text>{new Date(time).toLocaleString()}</Typography.Text>
                <br />
                <Typography.Text type="secondary">
                  {item.observation ? '荣耀 API' : 'Apple 已有观察'} · 非实时
                </Typography.Text>
              </>
            ) : (
              <Typography.Text type="secondary">尚无查询记录</Typography.Text>
            )
          },
        },
        {
          title: '待处理事项',
          width: 230,
          render: (_, item) => (
            <Typography.Text
              type={
                item.todo === 'review_rejection' || item.todo === 'verify' ? 'warning' : undefined
              }
            >
              {reviewTrackingTodos[item.todo]}
            </Typography.Text>
          ),
        },
        {
          title: '操作',
          width: 100,
          fixed: 'right',
          render: (_, item) => (
            <Button
              type="link"
              aria-label={`查看审核状态 ${item.kind}:${item.id}`}
              onClick={() => onSelect(`${item.kind}:${item.id}`)}
            >
              查看详情
            </Button>
          ),
        },
      ]}
    />
  )
}
