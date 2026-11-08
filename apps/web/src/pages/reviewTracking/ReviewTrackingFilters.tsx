/** @description 审核状态筛选区，项目变化清理原应用定位，筛选不重复读取或查询商店。 */
import { Button, Select } from 'antd'
import {
  channelLabels,
  reviewTrackingStates,
  reviewTrackingTodos,
  type ReleaseCenterProjectOption,
} from '@release-harbor/contracts'
import { PageFilters } from '../../components/PageFilters.tsx'
import { releaseApplicationOptions } from '../releaseCenter/releaseCenterPresentation.ts'
import type { ReviewFilters } from './useReviewTracking.ts'
/** 筛选项来自本机目录，回调只改变 URL。 */
interface Props {
  projects: ReleaseCenterProjectOption[]
  filters: ReviewFilters
  onChange: (patch: Partial<ReviewFilters>) => void
}
/** 独立菜单按项目、应用、渠道、审核状态及待办定位，手机自动换行。 */
export function ReviewTrackingFilters({ projects, filters, onChange }: Props) {
  return (
    <PageFilters activeCount={Object.values(filters).filter(Boolean).length}>
      <div className="review-tracking-filters">
        <Select
          aria-label="审核筛选项目"
          value={filters.project || undefined}
          placeholder="全部项目"
          allowClear
          showSearch
          optionFilterProp="label"
          options={projects.map((p) => ({ value: p.id, label: p.name }))}
          onChange={(value) => onChange({ project: value ?? '', application: '' })}
        />
        <Select
          aria-label="审核筛选应用"
          value={filters.application || undefined}
          placeholder="全部应用"
          allowClear
          showSearch
          optionFilterProp="label"
          options={releaseApplicationOptions(
            projects.filter((p) => !filters.project || p.id === filters.project),
          )}
          onChange={(value) => onChange({ application: value ?? '' })}
        />
        <Select
          aria-label="审核筛选渠道"
          value={filters.channel || undefined}
          placeholder="全部渠道"
          allowClear
          options={Object.entries(channelLabels).map(([value, label]) => ({ value, label }))}
          onChange={(value) => onChange({ channel: value ?? '' })}
        />
        <Select
          aria-label="审核筛选状态"
          value={filters.state || undefined}
          placeholder="全部审核状态"
          allowClear
          options={Object.entries(reviewTrackingStates).map(([value, label]) => ({ value, label }))}
          onChange={(value) => onChange({ state: value ?? '' })}
        />
        <Select
          aria-label="审核筛选待办"
          value={filters.todo || undefined}
          placeholder="全部待处理项"
          allowClear
          options={Object.entries(reviewTrackingTodos).map(([value, label]) => ({ value, label }))}
          onChange={(value) => onChange({ todo: value ?? '' })}
        />
        <Button
          onClick={() =>
            onChange({ project: '', application: '', channel: '', state: '', todo: '' })
          }
        >
          重置审核筛选
        </Button>
      </div>
    </PageFilters>
  )
}
