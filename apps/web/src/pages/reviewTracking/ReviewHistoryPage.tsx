/** @description 审核状态的本地发布关联页签，组合只读统计、筛选、列表和 URL 定位详情；不自动查询商店。 */
import { Alert, Button, Card, Empty, Flex, Statistic, Typography } from 'antd'
import { ReviewTrackingFilters } from './ReviewTrackingFilters.tsx'
import { ReviewTrackingTable } from './ReviewTrackingTable.tsx'
import { ReviewTrackingDetail } from './ReviewTrackingDetail.tsx'
import { useReviewTracking } from './useReviewTracking.ts'
import '../../styles/review-tracking.css'
/** 保留本工具执行后的历史观察，未接入渠道明确提示，禁止用回执假设审核结果。 */
export function ReviewHistoryPage() {
  const data = useReviewTracking(),
    items = data.visible
  const counts = [
    { label: '跟踪记录', value: items.length },
    { label: '审核中', value: items.filter((i) => i.state === 'in_review').length },
    { label: '待处理', value: items.filter((i) => i.todo !== 'none' && i.todo !== 'wait').length },
    { label: '已上架', value: items.filter((i) => i.state === 'published').length },
  ]
  return (
    <section aria-label="审核状态" className="review-tracking">
      <Flex wrap gap={12} justify="space-between" align="center">
        <Typography.Text type="secondary">
          按版本查看审核与上架观察，统计随筛选变化；刷新列表只读取本机记录。
        </Typography.Text>
        <Button onClick={data.refresh} loading={data.loading}>
          刷新审核记录
        </Button>
      </Flex>
      {data.error && (
        <Alert
          role="alert"
          type="error"
          showIcon
          title={data.error}
          action={<Button onClick={data.refresh}>重新读取审核记录</Button>}
        />
      )}
      <div className="review-tracking-statistics">
        {counts.map((c) => (
          <Card key={c.label} size="small">
            <Statistic title={c.label} value={data.error ? '—' : c.value} loading={data.loading} />
          </Card>
        ))}
      </div>
      <Card className="review-tracking-card">
        <ReviewTrackingFilters
          projects={data.response?.projects ?? []}
          filters={data.filters}
          onChange={data.filter}
        />
        <Typography.Paragraph type="secondary">
          {data.loading
            ? '正在读取审核记录…'
            : data.error
              ? '审核记录读取失败'
              : `找到 ${items.length} 条审核记录`}
        </Typography.Paragraph>
        {!data.error &&
          (!data.loading && items.length === 0 ? (
            <Empty description="没有匹配的本地送审记录；查询官网版本请切换到“商店状态”，无需重新发布。" />
          ) : (
            <ReviewTrackingTable
              items={items}
              loading={data.loading}
              page={data.page}
              onPage={data.paginate}
              onSelect={data.select}
            />
          ))}
      </Card>
      <ReviewTrackingDetail
        open={!!data.selected}
        item={data.record}
        loading={data.loading}
        error={data.error}
        onRetry={data.refresh}
        onClose={() => {
          data.select('')
          data.refresh()
        }}
      />
    </section>
  )
}
