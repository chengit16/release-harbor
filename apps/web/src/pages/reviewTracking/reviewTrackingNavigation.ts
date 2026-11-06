/** @description 审核状态菜单的安全定位；跳转只改变 URL，不查询商店、不授权或重试发布。 */
import { updateUrlState } from '../../app/useUrlState.ts'
/** 从发布详情带上应用与记录，清理发布抽屉及不匹配的旧筛选，不携带快照或账号。 */
export function openReviewTracking(
  projectId: string,
  applicationId: string,
  id: string,
  kind: 'plan' | 'apple' = 'plan',
): void {
  updateUrlState({
    view: 'reviews',
    reviewProject: projectId,
    reviewApplication: applicationId,
    reviewRecord: `${kind}:${id}`,
    reviewChannel: '',
    reviewState: '',
    reviewTodo: '',
    reviewPage: '',
    releaseTask: '',
    tab: '',
    plan: '',
    batch: '',
    batchRevision: '',
    releaseApple: '',
    appleRecord: '',
  })
  window.scrollTo({ top: 0 })
}
