/** @description 批次只读历史列表；空历史简短展示，选择仅改变查看对象，不触发准备或执行。 */
import { Button, Collapse, Space, Table, Tag, Typography } from 'antd'
import { channelLabels, type ChannelBinding, type ReleaseBatch } from '@release-harbor/contracts'
import { batchStatusLabels } from './BatchReview.tsx'

/** 加载进度与历史由页面提供，选择回调负责恢复当前批次定位。 */
export interface BatchHistoryProps {
  /** 当前应用的安全批次历史。 */
  batches: ReleaseBatch[]
  /** 只读请求尚未完成。 */
  loading: boolean
  /** 当前公开绑定用于显示渠道名称，缺失时不猜测商店。 */
  bindings: ChannelBinding[]
  /** 用户主动选择历史；不产生商店副作用。 */
  onSelect: (batch: ReleaseBatch) => void
}
/** 历史默认收起，避免挤占当前编辑空间；分页和表格内部滚动保留历史查看能力。 */
export function BatchHistory({ batches, loading, onSelect, bindings }: BatchHistoryProps) {
  if (!loading && !batches.length) {
    return <Typography.Text type="secondary">暂无历史批次，准备后会保留记录。</Typography.Text>
  }
  return (
    <Collapse
      items={[
        {
          key: 'history',
          label: `批次历史（${batches.length}）`,
          children: (
            <Table<ReleaseBatch>
              style={{ width: '100%', minWidth: 0 }}
              aria-label="批次历史"
              rowKey="id"
              dataSource={batches}
              loading={loading}
              pagination={{ pageSize: 5, hideOnSinglePage: true, showSizeChanger: false }}
              columns={[
                {
                  title: '批次',
                  key: 'batch',
                  render: (_, b) => (
                    <Space orientation="vertical" size={2}>
                      <Typography.Text>{b.draft.length} 个渠道</Typography.Text>
                      <Typography.Text type="secondary">
                        {new Date(b.createdAt).toLocaleString()}
                      </Typography.Text>
                    </Space>
                  ),
                },
                {
                  title: '进度',
                  key: 'progress',
                  render: (_, b) => {
                    const r = b.revisions.at(-1)
                    return r ? (
                      <Space wrap>
                        {r.targets.map((t, i) => (
                          <Tag key={t.id}>
                            {(() => {
                              const binding = bindings.find((b) => b.id === t.input.bindingId)
                              return binding ? channelLabels[binding.channel] : `渠道 ${i + 1}`
                            })()}{' '}
                            · {batchStatusLabels[t.status]}
                          </Tag>
                        ))}
                      </Space>
                    ) : (
                      '未准备'
                    )
                  },
                },
                {
                  title: '操作',
                  key: 'action',
                  width: 80,
                  render: (_, b) => (
                    <Button
                      type="link"
                      onClick={() => {
                        onSelect(b)
                      }}
                    >
                      查看
                    </Button>
                  ),
                },
              ]}
              scroll={{ x: 420 }}
            />
          ),
        },
      ]}
    />
  )
}
