/** @description 审核状态菜单默认展示商店查询，本地发布历史仅为可选关联，不限制直接查询官方版本。 */
import { FollowTasksPage } from './FollowTasksPage.tsx'
import { Tabs } from 'antd'
import { useUrlState, updateUrlState } from '../../app/useUrlState.ts'
import { ReviewHistoryPage } from './ReviewHistoryPage.tsx'
import { StoreStatusPage } from './StoreStatusPage.tsx'

/** 旧发布记录深链保持可读，新的默认入口不需要本机计划或执行记录。 */
export function ReviewTrackingPage() {
  const params = useUrlState()
  const active =
    params.get('reviewMode') === 'history' || params.get('reviewRecord')
      ? 'history'
      : params.get('reviewMode') === 'todos'
        ? 'todos'
        : params.get('reviewMode') === 'follows'
          ? 'follows'
          : 'store'
  return (
    <Tabs
      destroyOnHidden
      activeKey={active}
      onChange={(value) =>
        updateUrlState({
          reviewMode: value === 'store' ? '' : value,
          reviewRecord: '',
          reviewTarget: '',
        })
      }
      items={[
        { key: 'store', label: '商店状态', children: <StoreStatusPage /> },
        { key: 'follows', label: '跟踪任务', children: <FollowTasksPage /> },
        { key: 'todos', label: '待办处理', children: <StoreStatusPage todos /> },
        { key: 'history', label: '本地发布关联', children: <ReviewHistoryPage /> },
      ]}
    />
  )
}
