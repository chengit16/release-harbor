/** @description 共享筛选区域；桌面直接呈现，手机按需展开，筛选事实仍由原页面 URL 维护。 */
import type { ReactNode } from 'react'
import { Collapse } from 'antd'
import { useCompactLayout } from '../app/useCompactLayout.ts'

/** 仅调整筛选的呈现，不复制字段状态或触发请求。 */
export function PageFilters({
  children,
  activeCount = 0,
}: {
  /** 原页面的受控筛选控件。 */ children: ReactNode
  /** 已选条件数，用于折叠时仍能理解当前范围。 */ activeCount?: number
}) {
  const compact = useCompactLayout()
  return compact ? (
    <Collapse
      className="page-filter-disclosure"
      size="small"
      items={[
        {
          key: 'filters',
          label: `筛选条件${activeCount ? `（已选 ${activeCount} 项）` : '（全部）'}`,
          children,
        },
      ]}
    />
  ) : (
    <>{children}</>
  )
}
