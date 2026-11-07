/** @description 官方查询留存与版本差异；仅读取本机历史，人工记录在独立区块展示。 */
import { Collapse, Empty, Flex, List, Tag, Typography } from 'antd'
import type { StoreStatusSnapshot } from '@release-harbor/contracts'
import { compareStoreStatusHistory } from './storeStatusHistory.ts'
import { queryFailureLabels } from './StoreVersionResults.tsx'
import { StoreHistoryChanges } from './StoreHistoryChanges.tsx'

/** 完成顺序最近在前，失败不刷新旧事实；每个绑定最多显示三十次，分页避免拉长详情。 */
export function StoreQueryHistory({
  history,
}: {
  /** 仅当前可信绑定指纹的官方查询，默认和指定构建均保留。 */
  history: StoreStatusSnapshot[]
}) {
  return (
    <section className="store-tracking-section" aria-label="查询与变化记录">
      <Collapse
        items={[
          {
            key: 'queries',
            label: `查询与变化记录（${history.length}）`,
            children: (
              <>
                <Typography.Paragraph type="secondary">
                  仅留存启用后的最近三十次官方查询（非实时），旧缓存不回填。比较同范围的较早成功，时间为查询时间，不能确定状态实际变化时间。人工核对独立展示。
                </Typography.Paragraph>
                <List
                  dataSource={history}
                  locale={{
                    emptyText: <Empty description="尚无留存查询，请明确点击查询商店状态。" />,
                  }}
                  pagination={
                    history.length > 5
                      ? { pageSize: 5, size: 'small', showSizeChanger: false }
                      : false
                  }
                  renderItem={(snapshot, index) => {
                    // List 分页的 index 是当前页内位置，必须按原对象寻找完整历史的基线。
                    const comparison = compareStoreStatusHistory(history, history.indexOf(snapshot))
                    return (
                      <List.Item key={`${snapshot.checkedAt}:${index}`}>
                        <div className="store-query-history-content">
                          <Flex wrap gap={8} align="center">
                            <Typography.Text>
                              {new Date(snapshot.checkedAt).toLocaleString()}（非实时）
                            </Typography.Text>
                            <Tag>官方查询</Tag>
                            <Tag>
                              {snapshot.query
                                ? `指定构建 ${snapshot.query.buildNumber}`
                                : '默认查询'}
                            </Tag>
                            <Tag color={snapshot.code === 'observed' ? 'success' : 'error'}>
                              {snapshot.code === 'observed' ? '读取成功' : '查询失败'}
                            </Tag>
                          </Flex>
                          {snapshot.code !== 'observed' ? (
                            <Typography.Paragraph>
                              {queryFailureLabels[snapshot.code]} 未据此产生状态变化。
                            </Typography.Paragraph>
                          ) : (
                            <>
                              <Typography.Paragraph type="secondary">
                                {comparison.baseline
                                  ? `对比 ${new Date(comparison.baseline.checkedAt).toLocaleString()} 的同范围成功查询。`
                                  : '首次留存的同范围成功结果，不推断此前状态。'}
                                {!snapshot.versions.length && ' 官方本次未返回版本。'}
                                {!!comparison.baseline &&
                                  !comparison.changes.length &&
                                  ' 未发现可确认的状态变化。'}
                              </Typography.Paragraph>
                              <StoreHistoryChanges
                                channel={snapshot.channel}
                                changes={comparison.changes}
                              />
                            </>
                          )}
                        </div>
                      </List.Item>
                    )
                  }}
                />
              </>
            ),
          },
        ]}
      />
    </section>
  )
}
