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
    if (item.reconciliation)
      return '已追加人工核对记录，原执行回执保留；查看详情核对结论和后续处理。'
    const result = appleReviewMessages[item.code]
    const expired = item.status === 'ready' && item.state === 'attention'
    return expired ? '原摘要已过期，请重新准备后核对确认；本条尚未向商店提交。' : result
  }
  if (item.kind === 'plan') {
    if (item.attempt?.status === 'needs_reconciliation' && !item.needsReconciliation)
      return '原执行结果不明，已追加人工核对记录；查看详情核对结论，旧授权不会恢复。'
    if (item.attempt) return attemptMessages[item.attempt.code]
    if (item.invalidatedBy) return planInvalidationMessages[item.invalidatedBy]
    return '尚未向商店上传；查看摘要后明确确认才会执行。'
  }
  if (!item.revisionId) return `${item.targets.length} 个渠道，尚未准备。`
  const succeeded = item.targets.filter((target) => target.status === 'succeeded').length
  const unknown = item.targets.filter((target) => target.status === 'needs_reconciliation').length
  if (item.state === 'attention' && item.targets.every((target) => target.status === 'ready'))
    return '原摘要期限或依赖已失效，请在批次详情修正并重新准备。'
  return `${item.targets.length} 个渠道 · 执行成功 ${succeeded} 项${unknown ? ` · 原执行结果不明 ${unknown} 项` : ''}；各渠道结果以执行详情为准。`
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
    releaseCompose: '',
    releaseSelected: '',
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
    releaseFocus: '',
    releaseCompose: '',
    releaseSelected: '',
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

/** 首页处理状态细分过期、普通失败与未知结果，不改写原记录。 */
export function centerItemStateLabel(item: ReleaseCenterItem): string {
  if (item.needsReconciliation) return '结果待核对'
  // 汇总分组仍是本机阶段，主标签只使用原回执的具体事实，不提升为审核通过或已上架。
  if (item.state === 'completed') {
    if (item.kind === 'apple')
      return item.code === 'submitted'
        ? '审核提交已受理'
        : item.code === 'release_requested'
          ? '手动发布请求已受理'
          : '本机执行结束'
    if (item.kind === 'batch') return '各渠道执行已结束'
    switch (item.attempt?.code) {
      case 'build_uploaded':
        return '构建上传已接收'
      case 'build_available':
        return '构建处理完成'
      case 'build_processing':
        return '构建处理中'
      case 'draft_saved':
        return '草稿已保存'
      case 'oppo_version_processed':
        return '版本处理成功'
      case 'vivo_update_accepted':
        return '更新提交已接收'
      case 'meizu_review_submitted':
        return '新版本已进入审核'
      case 'huawei_review_submitted':
      case 'tencent_review_submitted':
      case 'harmony_review_submitted':
      case 'honor_review_submitted':
      case 'review_submitted':
        return '审核提交已受理'
      default:
        return '本机执行结束'
    }
  }
  if (item.state !== 'attention') return centerStateLabels[item.state]
  if (item.kind === 'plan') {
    if (item.attempt?.status === 'needs_reconciliation') return '已记录核对'
    if (item.attempt) return '执行未完成'
    return '需重新准备'
  }
  if (item.kind === 'apple')
    return item.reconciliation
      ? '已记录核对'
      : item.status === 'ready'
        ? '需重新准备'
        : '执行未完成'
  return '部分渠道需处理'
}

/** 构建仍在处理或尚待匹配时不使用绿色完成标签；其他颜色只表达原执行阶段。 */
export function centerItemStateColor(item: ReleaseCenterItem): string {
  if (item.needsReconciliation) return 'warning'
  if (item.state === 'completed' && item.kind === 'plan') {
    if (item.attempt?.code === 'build_processing') return 'processing'
    if (item.attempt?.code === 'build_uploaded') return 'warning'
  }
  return centerStateColors[item.state]
}
