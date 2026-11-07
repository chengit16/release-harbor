/** @description 查询历史的有限版本差异；保留状态标签和目标定位，目录缺项不推断下架。 */
import { Collapse, Flex, List, Typography } from 'antd'
import type { BindingChannel } from '@release-harbor/contracts'
import type { StoreStatusChange } from './storeStatusHistory.ts'
import { StoreVersionTag } from './StoreVersionTag.tsx'
import { storeVersionTitle } from './storeStatusPresentation.ts'

/** 差异默认折叠，避免大目录把详情拉长；无差异不生成空面板。 */
export function StoreHistoryChanges({
  channel,
  changes,
}: {
  /** 用于公开在架等状态的渠道限定。 */
  channel: BindingChannel
  /** 已完成同一查询范围与版本唯一性检查的差异。 */
  changes: StoreStatusChange[]
}) {
  if (!changes.length) return null
  return (
    <Collapse
      items={[
        {
          key: 'changes',
          label: `查看读取差异（${changes.length}）`,
          children: (
            <List
              dataSource={changes}
              renderItem={(change) => (
                <List.Item>
                  <div>
                    <Typography.Paragraph>
                      {storeVersionTitle(channel, change.version)}
                      {change.version.buildNumber && ` · 构建号 ${change.version.buildNumber}`}
                      {change.version.versionId && ` · ID ${change.version.versionId}`}
                    </Typography.Paragraph>
                    <Flex wrap gap={8} align="center">
                      {change.kind === 'not_returned' ? (
                        <Typography.Text>本次未返回（不代表下架）</Typography.Text>
                      ) : (
                        <>
                          <Typography.Text>
                            {change.kind === 'changed' ? '状态不同' : '本次读取'}
                          </Typography.Text>
                          {change.previous && (
                            <>
                              <StoreVersionTag channel={channel} version={change.previous} />
                              <span aria-label="变为">→</span>
                            </>
                          )}
                          <StoreVersionTag channel={channel} version={change.version} />
                        </>
                      )}
                    </Flex>
                  </div>
                </List.Item>
              )}
            />
          ),
        },
      ]}
    />
  )
}
