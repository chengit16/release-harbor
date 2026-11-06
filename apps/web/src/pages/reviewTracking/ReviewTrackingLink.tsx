/** @description 发布详情中的审核状态导航；不在发布表单内重复嵌入状态查询面板。 */
import { Button } from 'antd'
import { openReviewTracking } from './reviewTrackingNavigation.ts'
/** 定位字段只标识当前计划，不构成任何授权。 */
interface Props {
  projectId: string
  applicationId: string
  recordId: string
  kind?: 'plan' | 'apple'
}
/** 当前应用的审核记录在独立菜单查看，保留明确跳转。 */
export function ReviewTrackingLink({ projectId, applicationId, recordId, kind = 'plan' }: Props) {
  return (
    <Button onClick={() => openReviewTracking(projectId, applicationId, recordId, kind)}>
      查看审核状态
    </Button>
  )
}
