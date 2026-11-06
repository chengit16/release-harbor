/** @description 发布中心列表文案与导航；区分本机处理阶段和商店回执，不推断远端审核或上架。 */
import {
  attemptMessages,
  appleReviewMessages,
  planInvalidationMessages,
  type ReleaseCenterItem,
  type ReleaseCenterState,
  type ReleaseCenterProjectOption,
} from '@release-harbor/contracts'
import { updateUrlState } from '../../app/useUrlState.ts'

/** 总体处理阶段只用于列表分组；完成代表执行结束，不代表已上架。 */
export const centerStateLabels: Record<ReleaseCenterState, string> = {
  draft: '待准备',
  awaiting_confirmation: '待确认',
  awaiting_execution: '待执行',
  processing: '处理中',
  attention: '需处理',
  completed: '执行完成',
  cancelled: '已取消',
}
/** 状态颜色保持全站语义，批次混合结果以警示呈现。 */
export const centerStateColors: Record<ReleaseCenterState, string> = {
  draft: 'default',
  awaiting_confirmation: 'processing',
  awaiting_execution: 'processing',
  processing: 'processing',
  attention: 'warning',
  completed: 'success',
  cancelled: 'default',
}

/** 回执优先展示原事实；未知结果不能因为过期而被覆盖。 */
export function centerDescription(item: ReleaseCenterItem): string {
  if (item.kind === 'apple') {
    const result = appleReviewMessages[item.code]
    const expired = item.status === 'ready' && item.state === 'attention'
    return expired ? '原摘要已过期，请重新准备后核对确认；本条尚未向商店提交。' : result
  }
  if (item.kind === 'plan') {
    if (item.attempt) return attemptMessages[item.attempt.code]
    if (item.invalidatedBy) return planInvalidationMessages[item.invalidatedBy]
    return '尚未向商店上传；查看摘要后明确确认才会执行。'
  }
  if (!item.revisionId) return `${item.targets.length} 个渠道，尚未准备。`
  const succeeded = item.targets.filter((target) => target.status === 'succeeded').length
  const unknown = item.targets.filter((target) => target.status === 'needs_reconciliation').length
  if (item.state === 'attention' && item.targets.every((target) => target.status === 'ready'))
    return '原摘要期限或依赖已失效，请在批次详情修正并重新准备。'
  return `${item.targets.length} 个渠道 · 执行成功 ${succeeded} 项${unknown ? ` · 待核对 ${unknown} 项` : ''}；各渠道结果以执行详情为准。`
}

/** 发起或查看仅改变 URL；保留发布中心筛选与原配置定位，不做任何业务写入。 */
export function openReleaseWorkspace(
  projectId: string,
  applicationId: string,
  kind: 'plan' | 'batch' | 'apple' = 'plan',
  id = '',
  revisionId = '',
): void {
  updateUrlState({
    view: 'releases',
    project: projectId,
    application: applicationId,
    releaseTask: 'workspace',
    releaseView: kind === 'batch' ? 'batch' : '',
    releaseApple: kind === 'apple' ? 'review' : '',
    appleRecord: kind === 'apple' ? id : '',
    plan: kind === 'plan' ? id : '',
    batch: kind === 'batch' ? id : '',
    batchRevision: revisionId,
    tab: '',
  })
  window.scrollTo({ top: 0 })
}

/** 由应用管理进入筛选后的发布列表，避免在配置页内重复显示发布表单。 */
export function openReleaseCenter(projectId: string, applicationId: string): void {
  updateUrlState({
    view: 'releases',
    releaseProject: projectId,
    releaseApplication: applicationId,
    releaseChannel: '',
    releaseKind: '',
    releaseState: '',
    releasePage: '',
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

/** 生成可辨识的应用选项，跨项目同名应用也能正确选择。 */
export function releaseApplicationOptions(projects: ReleaseCenterProjectOption[]) {
  return projects.flatMap((project) =>
    project.applications.map((application) => ({
      value: application.id,
      label: `${project.name} / ${application.name} · ${application.platform === 'android' ? 'Android' : application.platform === 'ios' ? 'iOS' : 'HarmonyOS'}`,
      projectId: project.id,
      platform: application.platform,
    })),
  )
}

/** 列表动作名称与筛选共用，避免将 iOS 审核或手动发布笼统显示为单渠道上传。 */
export function centerKindLabel(item: ReleaseCenterItem): string {
  return item.kind === 'batch'
    ? '多渠道批次'
    : item.kind === 'apple'
      ? item.action === 'submit'
        ? 'iOS 提交审核'
        : 'iOS 手动发布'
      : item.platform === 'ios'
        ? 'iOS 上传构建'
        : '单渠道'
}
