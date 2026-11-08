/** @description 手机发布记录卡片；完整展示核心事实，分页和详情仍使用原 URL，不新增请求或执行入口。 */
import { Button, Card, Flex, Pagination, Tag, Typography } from 'antd'
import {
  channelLabels,
  appleVersionStates,
  type ReleaseCenterItem,
} from '@release-harbor/contracts'
import {
  centerDescription,
  centerItemStateLabel,
  centerKindLabel,
  centerItemStateColor,
  openReleaseWorkspace,
} from './releaseCenterPresentation.ts'

/** 当前页由父级与桌面表格共用，切换视口不清空定位。 */
export function ReleaseRecordCards({
  items,
  page,
  onPage,
}: {
  /** 已筛选的本机记录，不含商店实时状态。 */ items: ReleaseCenterItem[]
  /** 已校正的当前页码。 */ page: number
  /** 只更新 URL 页码。 */ onPage: (page: number) => void
}) {
  return (
    <div className="release-record-cards" role="list" aria-label="发布记录">
      {items.slice((page - 1) * 10, page * 10).map((item) => (
        <Card size="small" role="listitem" key={`${item.kind}:${item.id}`}>
          <div className="release-record-card-content">
            <div className="release-record-card-heading">
              <div>
                <Typography.Text strong>{item.applicationName}</Typography.Text>
                <div>
                  <Typography.Text type="secondary">{item.projectName}</Typography.Text>
                </div>
              </div>
              <Tag>
                {item.platform === 'ios'
                  ? 'iOS'
                  : item.platform === 'harmony'
                    ? 'HarmonyOS'
                    : 'Android'}
              </Tag>
            </div>
            <Typography.Text>
              {item.versionName
                ? `${item.versionName} · 构建 ${item.buildNumber ?? '未提供'}`
                : '尚未冻结版本'}{' '}
              · {centerKindLabel(item)}
            </Typography.Text>
            <Flex wrap gap={4}>
              {item.channels.map((channel) => (
                <Tag key={channel}>{channelLabels[channel]}</Tag>
              ))}
              {!item.channels.length && '绑定已变化'}
            </Flex>
            <div>
              <Tag color={centerItemStateColor(item)}>{centerItemStateLabel(item)}</Tag>
            </div>
            <Typography.Text type="secondary">{centerDescription(item)}</Typography.Text>
            {item.kind === 'apple' && item.observation && (
              <Typography.Text type="secondary">
                历史观察：{appleVersionStates[item.observation.state] ?? item.observation.state} ·{' '}
                {new Date(item.observation.checkedAt).toLocaleString()}（非实时）
              </Typography.Text>
            )}
            {item.kind === 'apple' && item.reconciliation && (
              <Typography.Text type="secondary">
                人工核对：
                {item.reconciliation.decision === 'present'
                  ? '已受理'
                  : '未执行且无处理中任务'} ·{' '}
                {new Date(item.reconciliation.checkedAt).toLocaleString()}
              </Typography.Text>
            )}
            <div className="release-record-card-footer">
              <span>{new Date(item.createdAt).toLocaleString()}</span>
              <Button
                aria-label={`查看${item.kind === 'batch' ? '批次' : item.kind === 'apple' ? '审核记录' : '计划'} ${item.id}`}
                onClick={() =>
                  openReleaseWorkspace(
                    item.projectId,
                    item.applicationId,
                    item.kind,
                    item.id,
                    item.kind === 'batch' ? (item.revisionId ?? '') : '',
                  )
                }
              >
                查看详情
              </Button>
            </div>
          </div>
        </Card>
      ))}
      <Pagination
        current={page}
        total={items.length}
        pageSize={10}
        hideOnSinglePage
        showSizeChanger={false}
        onChange={onPage}
        simple
      />
    </div>
  )
}
