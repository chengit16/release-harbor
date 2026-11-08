/** @description 发布中心的项目、应用、渠道与处理阶段筛选；只更新 URL，不触发发布动作。 */
import { Button, Select } from 'antd'
import { channelLabels, type ReleaseCenterProjectOption } from '@release-harbor/contracts'
import { PageFilters } from '../../components/PageFilters.tsx'
import { centerStateLabels, releaseApplicationOptions } from './releaseCenterPresentation.ts'
import type { ReleaseCenterFilters as Filters } from './useReleaseCenter.ts'

/** 筛选值由 URL 恢复，项目变化会清空原应用，防止不匹配的组合。 */
interface Props {
  /** 可信工作空间内公开选择项。 */
  projects: ReleaseCenterProjectOption[]
  /** URL 中的当前筛选值。 */
  filters: Filters
  /** 只在用户变更筛选时调用。 */
  onChange: (patch: Partial<Filters>) => void
}

/** 控件提供稳定可访问标签，窄屏自动换行。 */
export function ReleaseCenterFilters({ projects, filters, onChange }: Props) {
  return (
    <PageFilters activeCount={Object.values(filters).filter(Boolean).length}>
      <div className="release-center-filters" aria-label="发布记录筛选">
        <Select
          aria-label="筛选项目"
          value={filters.project || undefined}
          placeholder="全部项目"
          allowClear
          showSearch
          optionFilterProp="label"
          onChange={(value) => onChange({ project: value ?? '', application: '' })}
          options={projects.map((project) => ({ value: project.id, label: project.name }))}
        />
        <Select
          aria-label="筛选应用"
          value={filters.application || undefined}
          placeholder="全部应用"
          allowClear
          showSearch
          optionFilterProp="label"
          onChange={(value) => onChange({ application: value ?? '' })}
          options={releaseApplicationOptions(
            projects.filter((p) => !filters.project || p.id === filters.project),
          )}
        />
        <Select
          aria-label="筛选渠道"
          value={filters.channel || undefined}
          placeholder="全部渠道"
          allowClear
          onChange={(value) => onChange({ channel: value ?? '' })}
          options={Object.entries(channelLabels).map(([value, label]) => ({ value, label }))}
        />
        <Select
          aria-label="筛选发布方式"
          value={filters.kind || undefined}
          placeholder="全部方式"
          allowClear
          onChange={(value) => onChange({ kind: value ?? '' })}
          options={[
            { value: 'plan', label: '单渠道' },
            { value: 'batch', label: '多渠道批次' },
            { value: 'apple', label: 'iOS 审核与发布' },
          ]}
        />
        <Select
          aria-label="筛选处理状态"
          value={filters.state || undefined}
          placeholder="全部状态"
          allowClear
          onChange={(value) => onChange({ state: value ?? '' })}
          options={Object.entries(centerStateLabels).map(([value, label]) => ({ value, label }))}
        />
        <Button
          onClick={() =>
            onChange({ query: '', project: '', application: '', channel: '', kind: '', state: '' })
          }
        >
          重置筛选
        </Button>
      </div>
    </PageFilters>
  )
}
