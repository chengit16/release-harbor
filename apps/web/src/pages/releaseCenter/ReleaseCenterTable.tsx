/** @description 发布中心的分页列表，只呈现本机计划与批次事实；详情定位不授予执行许可。 */
import { Button, Space, Spin, Table, Tag, Typography } from 'antd'
import {
  appleVersionStates,
  channelLabels,
  type ReleaseCenterItem,
} from '@release-harbor/contracts'
import { useCompactLayout } from '../../app/useCompactLayout.ts'
import { ReleaseRecordCards } from './ReleaseRecordCards.tsx'
import { updateUrlState, useUrlState } from '../../app/useUrlState.ts'
import {
  centerDescription,
  centerKindLabel,
  centerItemStateColor,
  centerItemStateLabel,
  openReleaseWorkspace,
} from './releaseCenterPresentation.ts'

/** 表格数据已经按 URL 筛选，加载失败由父页明确处理。 */
interface Props {
  /** 当前筛选结果，按记录创建时间倒序。 */
  items: ReleaseCenterItem[]
  /** 读取时保留加载反馈。 */
  loading: boolean
}

/**
 * 长列表分页、长渠道集合最多展示两个标签，完整名称可在详情核对。
 * 长函数保留原因：列定义保持相邻便于核对列表摘要，状态解释和导航已独立维护。
 */
export function ReleaseCenterTable({ items, loading }: Props) {
  const compact = useCompactLayout()
  const params = useUrlState()
  const requestedPage = Number(params.get('releasePage'))
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
  const current = Math.min(page, Math.max(1, Math.ceil(items.length / 10)))
  const onPage = (value: number) => updateUrlState({ releasePage: value > 1 ? String(value) : '' })
  if (compact)
    return (
      <Spin spinning={loading}>
        <ReleaseRecordCards items={items} page={current} onPage={onPage} />
      </Spin>
    )
  return (
    <Table<ReleaseCenterItem>
      aria-label="发布记录"
      rowKey={(item) => `${item.kind}:${item.id}`}
      dataSource={items}
      loading={loading}
      scroll={{ x: 880 }}
      pagination={{
        current,
        pageSize: 10,
        showSizeChanger: false,
        hideOnSinglePage: true,
        onChange: onPage,
      }}
      columns={[
        {
          title: '应用 / 项目',
          key: 'application',
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
          title: '版本 / 方式',
          key: 'version',
          width: 160,
          render: (_, item) => (
            <Space orientation="vertical" size={2}>
              <Typography.Text>
                {item.versionName
                  ? `${item.versionName} (${item.buildNumber ?? '—'})`
                  : '尚未冻结版本'}
              </Typography.Text>
              <Typography.Text type="secondary">{centerKindLabel(item)}</Typography.Text>
            </Space>
          ),
        },
        {
          title: '渠道',
          key: 'channels',
          width: 170,
          render: (_, item) => (
            <Space wrap size={[0, 4]}>
              {item.channels.slice(0, 2).map((channel) => (
                <Tag key={channel}>{channelLabels[channel]}</Tag>
              ))}
              {item.channels.length > 2 && (
                <Tag title={item.channels.map((channel) => channelLabels[channel]).join('、')}>
                  +{item.channels.length - 2}
                </Tag>
              )}
              {!item.channels.length && (
                <Typography.Text type="secondary">绑定已变化</Typography.Text>
              )}
            </Space>
          ),
        },
        {
          title: '处理状态 / 回执',
          key: 'state',
          width: 290,
          render: (_, item) => (
            <>
              <Tag color={centerItemStateColor(item)}>{centerItemStateLabel(item)}</Tag>
              <Typography.Paragraph type="secondary" className="release-center-receipt">
                {centerDescription(item)}
              </Typography.Paragraph>
              {item.kind === 'apple' && item.observation && (
                <Typography.Paragraph type="secondary" className="release-center-receipt">
                  历史观察：{appleVersionStates[item.observation.state] ?? item.observation.state} ·{' '}
                  {new Date(item.observation.checkedAt).toLocaleString()}（非实时）
                </Typography.Paragraph>
              )}
              {item.kind === 'apple' && item.reconciliation && (
                <Typography.Paragraph type="secondary" className="release-center-receipt">
                  人工核对：
                  {item.reconciliation.decision === 'present'
                    ? '已受理'
                    : '未执行且无处理中任务'} ·{' '}
                  {new Date(item.reconciliation.checkedAt).toLocaleString()}
                </Typography.Paragraph>
              )}
            </>
          ),
        },
        {
          title: '创建时间',
          key: 'time',
          width: 170,
          render: (_, item) => new Date(item.createdAt).toLocaleString(),
        },
        {
          title: '操作',
          key: 'action',
          width: 100,
          fixed: 'right',
          render: (_, item) => (
            <Button
              type="link"
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
          ),
        },
      ]}
    />
  )
}
