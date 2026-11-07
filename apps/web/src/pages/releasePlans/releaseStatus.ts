/** @description 计划列表和执行记录共用的状态投影；授权消费仅是审计事实，成功必须来自执行回执。 */
import {
  attemptMessages,
  executionDiagnostics,
  planInvalidationMessages,
  type ReleaseAttempt,
  type ReleasePlanView,
} from '@release-harbor/contracts'

/** 文案和颜色来自执行事实，不受计划仍已确认或授权曾消费影响。 */
export interface ReleaseStatus {
  label: string
  color: 'success' | 'error' | 'warning' | 'processing' | 'default'
  description: string
}
/** 没有远端许可的失败明确显示未上传，小米受理与华为草稿分别表达。 */
export function attemptStatus(attempt: ReleaseAttempt): ReleaseStatus {
  const label =
    attempt.status === 'succeeded'
      ? attempt.code === 'build_uploaded'
        ? '上传已接收 · 待核对构建'
        : attempt.code === 'build_available'
          ? '构建可用'
          : attempt.code === 'build_processing'
            ? '构建处理中'
            : attempt.code === 'tencent_review_submitted' ||
                attempt.code === 'harmony_review_submitted' ||
                attempt.code === 'huawei_review_submitted' ||
                attempt.code === 'meizu_review_submitted' ||
                attempt.code === 'honor_review_submitted'
              ? '已提交审核'
              : attempt.code === 'vivo_update_accepted'
                ? '更新已接收'
                : attempt.code === 'oppo_version_processed'
                  ? '版本处理成功'
                  : attempt.code === 'review_submitted'
                    ? '已提交审核'
                    : '草稿已保存'
      : attempt.status === 'failed'
        ? '提交前失败 · 未上传'
        : attempt.status === 'interrupted'
          ? '执行前中断 · 未上传'
          : attempt.status === 'needs_reconciliation'
            ? '待核对'
            : attempt.status === 'running'
              ? '正在执行'
              : '正在复核'
  const color =
    attempt.status === 'succeeded'
      ? 'success'
      : attempt.status === 'failed'
        ? 'error'
        : ['needs_reconciliation', 'interrupted'].includes(attempt.status)
          ? 'warning'
          : 'processing'
  return {
    label,
    color,
    description: attempt.diagnostic
      ? executionDiagnostics[attempt.diagnostic]
      : attemptMessages[attempt.code],
  }
}
/** 有执行时优先呈现真实执行结果；计划过期不能覆盖已形成的终态。 */
export function planStatus(
  view: ReleasePlanView,
  attempt: ReleaseAttempt | undefined,
): ReleaseStatus {
  if (attempt) return attemptStatus(attempt)
  return {
    label:
      view.plan.status === 'cancelled'
        ? '已取消'
        : !view.current
          ? '已失效'
          : view.plan.status === 'confirmed'
            ? '已确认 · 尚未执行'
            : '待确认',
    color: view.current ? 'processing' : 'default',
    description: view.invalidatedBy
      ? planInvalidationMessages[view.invalidatedBy]
      : '尚未开始向商店上传',
  }
}
/** 用户声明与系统结果分别保留，小米结论不能被显示成“未保存”或“已有草稿”。 */
export function reconciliationStatus(
  decision: NonNullable<ReleaseAttempt['reconciliation']>['decision'],
): string {
  return decision === 'build_present'
    ? '构建已存在；相同安装包不可重复上传'
    : decision === 'no_build'
      ? '未接收且无处理中任务；可重新准备'
      : decision === 'submission_present'
        ? '审核提交已存在；相同安装包不可重复提交'
        : decision === 'draft_present'
          ? '草稿已存在；相同安装包不可重复上传'
          : decision === 'not_submitted'
            ? '未提交且无处理中任务；可重新准备'
            : '未保存且无处理中任务；可创建新计划'
}
