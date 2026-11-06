/** @description 审核状态菜单默认展示商店查询，本地发布历史仅为可选关联，不限制直接查询官方版本。 */
import { Tabs } from 'antd'
import { useUrlState, updateUrlState } from '../../app/useUrlState.ts'
import { ReviewHistoryPage } from './ReviewHistoryPage.tsx'
import { StoreStatusPage } from './StoreStatusPage.tsx'

/** 旧发布记录深链保持可读，新的默认入口不需要本机计划或执行记录。 */
export function ReviewTrackingPage() {
  const params = useUrlState()
  const active =
    params.get('reviewMode') === 'history' || params.get('reviewRecord') ? 'history' : 'store'
  return (
    <Tabs
      activeKey={active}
      onChange={(value) =>
        updateUrlState({ reviewMode: value === 'history' ? 'history' : '', reviewRecord: '' })
      }
      items={[
        { key: 'store', label: '商店状态', children: <StoreStatusPage /> },
        { key: 'history', label: '本地发布关联', children: <ReviewHistoryPage /> },
      ]}
    />
  )
}
