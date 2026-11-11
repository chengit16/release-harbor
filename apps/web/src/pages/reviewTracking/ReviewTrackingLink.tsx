/** @description 发布详情中的审核状态导航；不在发布表单内重复嵌入状态查询面板。 */
import { Button, Space } from 'antd'
import { useTeamAccess } from '../team/teamAccess.tsx'
import { updateUrlState } from '../../app/useUrlState.ts'
import { openReviewTracking } from './reviewTrackingNavigation.ts'
/** 定位字段只标识当前计划，不构成任何授权。 */
interface Props {
  projectId: string
  applicationId: string
  recordId: string
  kind?: 'plan' | 'apple'
  /** 仅已受理的送审记录提供入口，点击仍需在独立菜单显式开启。 */
  followBindingId?: string
}
/** 当前应用的审核记录在独立菜单查看，保留明确跳转。 */
export function ReviewTrackingLink({
  projectId,
  applicationId,
  recordId,
  kind = 'plan',
  followBindingId,
}: Props) {
  const access = useTeamAccess()
  if (!access.menu('reviews')) return null
  return (
    <Space wrap>
      <Button onClick={() => openReviewTracking(projectId, applicationId, recordId, kind)}>
        查看审核状态
      </Button>
      {!access.restricted && followBindingId && (
        <Button
          onClick={() =>
            updateUrlState({
              view: 'reviews',
              reviewMode: '',
              reviewRecord: '',
              reviewProject: projectId,
              reviewApplication: applicationId,
              reviewTarget: followBindingId,
              reviewChannel: '',
              reviewState: '',
              reviewTodo: '',
              releaseTask: '',
              plan: '',
              appleRecord: '',
            })
          }
        >
          开启审核跟踪
        </Button>
      )}
    </Space>
  )
}
