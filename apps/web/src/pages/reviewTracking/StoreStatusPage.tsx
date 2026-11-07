/** @description 独立商店状态查询页面；绑定目录直接展示，查询按钮才访问官方接口。 */
import { Alert, Button, Card, Empty, Flex, Select, Statistic, Typography } from 'antd'
import { channelLabels, type StoreStatusTarget } from '@release-harbor/contracts'
import { useStoreStatus } from './useStoreStatus.ts'
import { StoreStatusDetails } from './StoreStatusDetails.tsx'
import { StoreStatusList } from './StoreStatusList.tsx'
import { StoreTodoList } from './StoreTodoList.tsx'
import { storeTodos } from './storeTodos.ts'
import '../../styles/review-tracking.css'
import '../../styles/store-status.css'

const platformLabels = { android: 'Android', ios: 'iOS', harmony: 'HarmonyOS' }

function options(targets: StoreStatusTarget[], field: 'project' | 'application') {
  // 多商店按应用 ID 去重；同名的不同平台仍保留独立选项，跨项目时补足归属。
  const includeProject = new Set(targets.map((item) => item.projectId)).size > 1
  return [
    ...new Map(
      targets.map((item) => [
        item[`${field}Id`],
        {
          value: item[`${field}Id`],
          label:
            field === 'project'
              ? item.projectName
              : `${includeProject ? `${item.projectName} / ` : ''}${item.applicationName} · ${platformLabels[item.platform]}`,
        },
      ]),
    ).values(),
  ]
}

/** 默认从绑定查询官方版本，未发布应用也可查看；历史本机回执单独保留。 */
export function StoreStatusPage({
  todos = false,
}: {
  /** 待办视图与官方目录共用筛选和详情，仅使用已有缓存。 */ todos?: boolean
}) {
  const data = useStoreStatus()
  const targets = data.response?.targets ?? []
  const snapshots = data.response?.snapshots ?? []
  const trackedSnapshots = data.response?.trackedSnapshots ?? []
  const manualRecords = data.response?.manualRecords ?? []
  // 目录读取失败与“没有绑定”分开；单次查询失败仍允许查看已加载的目录。
  const unavailable = !data.response && !!data.error
  const versions = data.visible.flatMap(
    (target) => snapshots.find((item) => item.bindingId === target.bindingId)?.versions ?? [],
  )
  const stats = [
    { label: '商店绑定', value: data.visible.length },
    {
      label: '审核中',
      value: versions.filter((item) =>
        ['in_review', 'pre_review', 'qualification_review'].includes(item.state),
      ).length,
    },
    {
      label: '待查询',
      value: data.visible.filter(
        (target) =>
          target.querySupported && !snapshots.some((item) => item.bindingId === target.bindingId),
      ).length,
    },
    { label: '已上架', value: versions.filter((item) => item.state === 'published').length },
  ]
  return (
    <section aria-label="商店状态查询" className="review-tracking">
      <Flex wrap gap={12} justify="space-between" align="center">
        <Typography.Text type="secondary">
          {todos
            ? '根据已有查询和人工记录整理处理事项，查看待办不会访问商店。'
            : '选择应用与渠道，直接查询官方版本状态，无需先在本工具发布。'}
        </Typography.Text>
        <Button onClick={data.refresh} loading={data.loading} disabled={!!data.querying}>
          刷新商店目录
        </Button>
      </Flex>
      <Alert
        type="info"
        showIcon
        title={todos ? '待办依据已有记录整理' : '查询结果来自商店官方来源'}
        description={
          todos
            ? '每项保留来源与核对时间。人工记录与官方结果分别展示；处理指引不会自动送审或上线。'
            : '点击查询才访问商店；页面刷新仅读取历史结果（非实时）。官网手动提交的版本也可查询，各渠道查询范围见详情。'
        }
      />
      {data.error && <Alert role="alert" type="error" showIcon title={data.error} />}
      <div className="review-tracking-statistics">
        {stats.map((item) => (
          <Card key={item.label} size="small">
            <Statistic
              title={item.label}
              value={unavailable ? '—' : item.value}
              loading={data.loading}
            />
          </Card>
        ))}
      </div>
      <Card className="review-tracking-card">
        <div className="store-status-filters">
          <Select
            aria-label="审核筛选项目"
            value={data.filters.project || undefined}
            placeholder="全部项目"
            allowClear
            options={options(targets, 'project')}
            onChange={(value) => data.filter({ project: value ?? '', application: '' })}
          />
          <Select
            aria-label="审核筛选应用"
            value={data.filters.application || undefined}
            placeholder="全部应用"
            allowClear
            showSearch
            optionFilterProp="label"
            optionRender={(option) => (
              <span className="store-status-application-option">{option.label}</span>
            )}
            options={options(
              targets.filter(
                (item) => !data.filters.project || item.projectId === data.filters.project,
              ),
              'application',
            )}
            onChange={(value) => data.filter({ application: value ?? '' })}
          />
          <Select
            aria-label="审核筛选渠道"
            value={data.filters.channel || undefined}
            placeholder="全部渠道"
            allowClear
            options={Object.entries(channelLabels).map(([value, label]) => ({ value, label }))}
            onChange={(value) => data.filter({ channel: value ?? '' })}
          />
          <Button
            onClick={() => {
              data.filter({ project: '', application: '', channel: '' })
            }}
          >
            重置查询筛选
          </Button>
        </div>
        <Typography.Paragraph type="secondary">
          {data.loading
            ? '正在读取商店目录…'
            : unavailable
              ? '商店目录读取失败'
              : `找到 ${data.visible.length} 个商店绑定`}
        </Typography.Paragraph>
        {!unavailable &&
          (!data.loading && !data.visible.length ? (
            <Empty description="暂无匹配的商店绑定，请调整筛选或到应用管理配置绑定。" />
          ) : todos ? (
            <StoreTodoList
              items={storeTodos(data.visible, snapshots, trackedSnapshots, manualRecords)}
              onSelect={data.select}
            />
          ) : (
            <StoreStatusList
              targets={data.visible}
              snapshots={snapshots}
              querying={data.querying}
              onSelect={data.select}
              onQuery={(item) => void data.query(item)}
            />
          ))}
      </Card>
      <StoreStatusDetails
        key={data.target?.bindingId ?? 'closed'}
        target={data.target}
        snapshots={snapshots}
        trackedSnapshots={trackedSnapshots}
        manualRecords={manualRecords}
        querying={data.querying}
        onClose={data.close}
        onQuery={(item, query) => void data.query(item, query)}
        onManualSaved={data.refresh}
      />
    </section>
  )
}
