/** @description 审核状态手机卡片，版本、状态、时间和待办完整展示，不要求横向滚动才能判断结果。 */
import { Button, Card, Flex, Pagination, Space, Spin, Tag, Typography } from 'antd'
import {
  channelLabels,
  reviewTrackingStates,
  reviewTrackingTodos,
  type ReviewTrackingItem,
} from '@release-harbor/contracts'
import {
  reviewRecordLabel,
  reviewStateColor,
  reviewObservationSource,
  reviewQueryHint,
} from './reviewTrackingPresentation.ts'
/** 与桌面共享筛选和分页事实，卡片只呈现已加载的安全摘要。 */
interface Props {
  items: ReviewTrackingItem[]
  loading: boolean
  page: number
  onPage: (page: number) => void
  onSelect: (id: string) => void
}
/** 每页十条，分页仅改变 URL，不查询商店或执行发布。 */
export function ReviewTrackingMobileList({ items, loading, page, onPage, onSelect }: Props) {
  return (
    <Spin spinning={loading}>
      <div role="list" aria-label="审核记录列表" className="review-tracking-mobile-list">
        {items.slice((page - 1) * 10, page * 10).map((item) => {
          const time = item.observation?.checkedAt ?? item.appleObservation?.checkedAt
          return (
            <Card key={`${item.kind}:${item.id}`} size="small" role="listitem">
              <Flex
                wrap
                gap={8}
                justify="space-between"
                align="center"
                className="review-tracking-mobile-heading"
              >
                <Typography.Text strong style={{ minWidth: 0 }}>
                  {item.applicationName}
                </Typography.Text>
                <Tag color={reviewStateColor(item.state)}>{reviewTrackingStates[item.state]}</Tag>
              </Flex>
              <Space orientation="vertical" size={6} className="review-tracking-mobile-summary">
                <Typography.Text type="secondary">
                  {item.projectName} · {channelLabels[item.channel]}
                </Typography.Text>
                <Typography.Text>
                  {item.versionName} ({item.buildNumber}) · {reviewRecordLabel(item)}
                </Typography.Text>
                <Typography.Text type="secondary">
                  {time
                    ? `${new Date(time).toLocaleString()} · ${reviewObservationSource(item)}（非实时）`
                    : reviewQueryHint(item)}
                </Typography.Text>
                <Typography.Text
                  type={
                    item.todo === 'review_rejection' || item.todo === 'verify'
                      ? 'warning'
                      : undefined
                  }
                >
                  {reviewTrackingTodos[item.todo]}
                </Typography.Text>
                <Button
                  aria-label={`查看审核状态 ${item.kind}:${item.id}`}
                  onClick={() => onSelect(`${item.kind}:${item.id}`)}
                >
                  查看详情
                </Button>
              </Space>
            </Card>
          )
        })}
      </div>
      {items.length > 10 && (
        <Pagination
          current={page}
          total={items.length}
          pageSize={10}
          showSizeChanger={false}
          onChange={onPage}
        />
      )}
    </Spin>
  )
}
