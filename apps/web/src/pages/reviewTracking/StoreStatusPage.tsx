/** @description 独立商店状态查询页面；绑定目录直接展示，查询按钮才访问官方接口。 */
import { Alert, Button, Card, Empty, Flex, Select, Typography } from 'antd'
import { channelLabels, type StoreStatusTarget } from '@release-harbor/contracts'
import { useCompactLayout } from '../../app/useCompactLayout.ts'
import { PageFilters } from '../../components/PageFilters.tsx'
import { PageHelp } from '../../components/PageHelp.tsx'
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

/** 默认从绑定查询官方版本，未发布应用也可查看；历史本机回执单独保留。
 * 长函数保留原因：目录、待办共用筛选和详情，统计只投影当前缓存，避免分散上下文导致来源混用。 */
export function StoreStatusPage({
  todos = false,
}: {
  /** 待办视图与官方目录共用筛选和详情，仅使用已有缓存。 */ todos?: boolean
}) {
  const compact = useCompactLayout()
  const data = useStoreStatus()
  const targets = data.response?.targets ?? []
  const snapshots = data.response?.snapshots ?? []
  const trackedSnapshots = data.response?.trackedSnapshots ?? []
  const manualRecords = data.response?.manualRecords ?? []
  // 目录读取失败与“没有绑定”分开；单次查询失败仍允许查看已加载的目录。
  const unavailable = !data.response && !!data.error
  // 只统计当前成功缓存；没有证据时显示未知，不能把未查询或失败解释为官方没有审核／在架版本。
  const successful = data.visible
    .map((target) => snapshots.find((item) => item.bindingId === target.bindingId))
    .filter((snapshot) => snapshot?.code === 'observed')
  const hasCachedResult = data.visible.some((target) =>
    snapshots.some((snapshot) => snapshot.bindingId === target.bindingId),
  )
  const knownCount = (value: number): number | string =>
    unavailable || data.loading
      ? '—'
      : !data.visible.length
        ? '—'
        : successful.length
          ? value
          : hasCachedResult
            ? '未知'
            : '尚未查询'
  const stats = [
    { label: '已配置渠道', value: data.visible.length },
    {
      label: '已知审核中',
      value: knownCount(
        successful.filter((snapshot) =>
          snapshot?.versions.some((item) =>
            ['in_review', 'pre_review', 'qualification_review'].includes(item.state),
          ),
        ).length,
      ),
    },
    {
      label: '待查询渠道',
      value: data.visible.filter(
        (target) =>
          target.querySupported && !snapshots.some((item) => item.bindingId === target.bindingId),
      ).length,
    },
    {
      label: '已知在架',
      value: knownCount(
        successful.filter((snapshot) =>
          snapshot?.versions.some((item) => item.state === 'published'),
        ).length,
      ),
    },
  ]
  return (
    <section aria-label="商店状态查询" className="review-tracking">
      <Flex wrap gap={12} justify="space-between" align="center">
        <div className="compact-metrics" aria-label="渠道概览">
          {stats.map((item) => (
            <span key={item.label}>
              {item.label}
              <strong>{unavailable || data.loading ? '—' : item.value}</strong>
            </span>
          ))}
          <span>
            成功缓存{' '}
            {unavailable || data.loading ? '—' : `${successful.length}/${data.visible.length}`}
            （非实时）
          </span>
        </div>
        <Button onClick={data.refresh} loading={data.loading} disabled={!!data.querying}>
          刷新商店目录
        </Button>
      </Flex>
      {data.error && <Alert role="alert" type="error" showIcon title={data.error} />}
      <Card
        className="review-tracking-card"
        variant={compact ? 'borderless' : undefined}
        styles={{ body: compact ? { padding: 0 } : undefined }}
        style={{ background: compact ? 'transparent' : undefined }}
      >
        <PageFilters activeCount={Object.values(data.filters).filter(Boolean).length}>
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
        </PageFilters>
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
              items={storeTodos(
                data.visible,
                snapshots,
                trackedSnapshots,
                manualRecords,
                data.response?.materialSnapshots ?? [],
              )}
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
      <PageHelp title={todos ? '待办来源与处理说明' : '查询范围与非实时说明'}>
        <p>
          {todos
            ? '每项保留来源与核对时间。人工记录与官方结果分别展示；处理指引不会自动送审或上线。'
            : '手动查询或明确开启的只读跟踪会访问商店；页面刷新仅读取历史结果（非实时）。官网手动提交的版本也可查询，各渠道查询范围见详情。'}
        </p>
      </PageHelp>
      <StoreStatusDetails
        key={data.target?.bindingId ?? 'closed'}
        target={data.target}
        snapshots={snapshots}
        trackedSnapshots={trackedSnapshots}
        manualRecords={manualRecords}
        queryHistory={data.response?.queryHistory ?? []}
        materialSnapshots={data.response?.materialSnapshots ?? []}
        querying={data.querying}
        operationError={data.error}
        onClose={data.close}
        onQuery={(item, query) => void data.query(item, query)}
        onInspect={(item, versionId) => void data.query(item, undefined, versionId)}
        onManualSaved={data.refresh}
      />
    </section>
  )
}
