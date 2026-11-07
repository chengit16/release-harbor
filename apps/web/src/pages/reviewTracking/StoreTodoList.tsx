/** @description 审核状态内的待办列表；保留版本、来源和时间，按钮只跳转详情或已有发布流程。 */
import { Button, Empty, Flex, List, Select, Tag, Typography } from 'antd'
import { channelLabels } from '@release-harbor/contracts'
import { storeTodoLabels, type StoreTodo } from './storeTodos.ts'
import { openReleaseCenter } from '../releaseCenter/releaseCenterPresentation.ts'
import { updateUrlState, useUrlState } from '../../app/useUrlState.ts'

/** 分类来自 URL，刷新与前后退恢复筛选；查看待办不自动查询商店。 */
export function StoreTodoList({
  items,
  onSelect,
}: {
  /** 当前项目、应用、渠道筛选后的待办。 */
  items: StoreTodo[]
  /** 定位可信绑定详情，不执行查询。 */
  onSelect: (id: string) => void
}) {
  const params = useUrlState()
  const selected = params.get('storeTodo') ?? ''
  const visible = items.filter((item) => !selected || item.kind === selected)
  return (
    <section aria-label="商店待办">
      <Flex wrap gap={12} align="center" justify="space-between">
        <Typography.Text>待处理 {visible.length} 项（基于已有记录，非实时）</Typography.Text>
        <Select
          aria-label="待办分类"
          placeholder="全部待办"
          allowClear
          value={selected || undefined}
          style={{ minWidth: 180 }}
          options={Object.entries(storeTodoLabels).map(([value, label]) => ({ value, label }))}
          onChange={(value) => updateUrlState({ storeTodo: value ?? '' })}
        />
      </Flex>
      <List
        dataSource={visible}
        pagination={{ pageSize: 8 }}
        locale={{
          emptyText: <Empty description="当前缓存中暂无匹配待办；未查询渠道仍需显式查询后确认。" />,
        }}
        renderItem={(item) => (
          <List.Item key={item.id} className="store-todo-item" style={{ display: 'grid' }}>
            <List.Item.Meta
              className="store-todo-content"
              style={{ minWidth: 0, overflowWrap: 'anywhere' }}
              title={
                <Flex wrap gap={8}>
                  <Tag color={item.kind === 'rejected' ? 'error' : 'warning'}>
                    {storeTodoLabels[item.kind]}
                  </Tag>
                  <Typography.Text strong>
                    {item.target.applicationName} · {channelLabels[item.target.channel]}
                  </Typography.Text>
                  <Tag>
                    {item.source === 'manual'
                      ? '人工核对'
                      : item.source === 'capability'
                        ? '能力提示'
                        : '官方查询'}
                  </Tag>
                </Flex>
              }
              description={
                <>
                  <div>
                    {item.target.projectName} · {item.version?.versionName ?? '版本未确定'}
                    {item.version?.buildNumber && ` · 构建号 ${item.version.buildNumber}`}
                  </div>
                  <div>
                    {item.checkedAt
                      ? `${new Date(item.checkedAt).toLocaleString()}（非实时）`
                      : '尚无核对记录'}
                  </div>
                  <div>{item.guidance}</div>
                </>
              }
            />
            <Flex wrap gap={8}>
              <Button onClick={() => onSelect(item.target.bindingId)}>查看处理详情</Button>
              {item.kind === 'manual_release' && (
                <Button
                  onClick={() =>
                    openReleaseCenter(item.target.projectId, item.target.applicationId)
                  }
                >
                  前往发布中心
                </Button>
              )}
            </Flex>
          </List.Item>
        )}
      />
    </section>
  )
}
