/** @description 审核状态菜单只读汇总；跨项目读取已执行渠道目标和已有观察，不执行商店请求或授权。 */
import type { ApplicationCatalog, ProjectStore } from '@release-harbor/domain'
import {
  isReviewSubmissionAction,
  type ReviewTrackingItem,
  type ReviewTrackingResponse,
  type ReviewTrackingPlanItem,
  type ReviewTrackingAppleItem,
  type AppleReviewRecord,
  type ReleaseObservation,
} from '@release-harbor/contracts'
import type { ReleasePlansService } from './release-plans.service.ts'
import type { ReleaseExecutionService } from './release-execution.service.ts'
import type { ReleaseObservationService } from './release-observation.service.ts'
import type { AppleReviewService } from './apple-review.service.ts'

function observedState(record: AppleReviewRecord): ReviewTrackingItem['state'] {
  const state = record.observation?.state
  if (!state)
    return record.status === 'unknown' && !record.reconciliation ? 'unknown' : 'not_queried'
  if (['WAITING_FOR_REVIEW', 'IN_REVIEW'].includes(state)) return 'in_review'
  if (['REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY'].includes(state)) return 'rejected'
  if (
    ['PENDING_DEVELOPER_RELEASE', 'PENDING_APPLE_RELEASE', 'PROCESSING_FOR_APP_STORE'].includes(
      state,
    )
  )
    return 'approved'
  if (['READY_FOR_SALE', 'READY_FOR_DISTRIBUTION'].includes(state)) return 'published'
  return 'unknown'
}
function todo(
  state: ReviewTrackingItem['state'],
  unknown: boolean,
  channel: string,
  latest?: ReleaseObservation,
): ReviewTrackingItem['todo'] {
  if (unknown || state === 'unknown' || (latest && latest.code !== 'observed')) return 'verify'
  if (state === 'rejected') return 'review_rejection'
  if (state === 'published') return 'none'
  if (state === 'removed') return 'store_console'
  if (state === 'in_review' || state === 'approved') return 'wait'
  return ['honor', 'meizu'].includes(channel) ? 'query' : 'store_console'
}
/** 同一批次的每个已执行渠道各占一行，不能把混合结果压成一个审核状态。 */
export class ReviewTrackingService {
  constructor(
    private readonly projects: ProjectStore,
    private readonly applications: ApplicationCatalog,
    private readonly plans: Pick<ReleasePlansService, 'history'>,
    private readonly execution: Pick<ReleaseExecutionService, 'list'>,
    private readonly observations: Pick<ReleaseObservationService, 'applicationHistory'>,
    private readonly apple?: Pick<AppleReviewService, 'list'>,
  ) {}
  /**
   * 工作空间固定来自本机控制面；任一源故障整体报错，不以空列表隐藏读取失败。
   * 长函数保留原因：逐项目与应用集中汇总各源，字段投影及过滤相邻，状态与待办规则已独立维护。
   */
  async list(): Promise<ReviewTrackingResponse> {
    // 1. 只遍历可信空间目录，当前空间之外的应用不参与汇总。
    const response: ReviewTrackingResponse = { projects: [], items: [] }
    for (const project of await this.projects.list('local')) {
      const applications = await this.applications.list('local', project.id)
      response.projects.push({
        id: project.id,
        name: project.name,
        applications: applications.map(({ id, name, platform }) => ({ id, name, platform })),
      })
      for (const application of applications) {
        const args = ['local', project.id, application.id] as const
        const [plans, attempts, history, apple] = await Promise.all([
          this.plans.history(...args),
          this.execution.list(...args),
          this.observations.applicationHistory(project.id, application.id),
          application.platform === 'ios' && this.apple
            ? this.apple.list(project.id, application.id)
            : Promise.resolve([]),
        ])
        const base = {
          projectId: project.id,
          projectName: project.name,
          applicationId: application.id,
          applicationName: application.name,
          platform: application.platform,
        }
        // 2. 只有已结束且取得远端许可的送审动作进入跟踪；草稿和构建上传不冒充审核。
        for (const plan of plans) {
          const s = plan.snapshot,
            attempt = attempts.find((a) => a.planId === plan.id)
          if (
            !isReviewSubmissionAction(s.action) ||
            !attempt?.remoteStartedAt ||
            !attempt.finishedAt ||
            !s.artifact.identity
          )
            continue
          const latest = history.find((r) => r.planId === plan.id)
          const unknown = attempt.status === 'needs_reconciliation' && !attempt.reconciliation
          const state = latest?.state ?? (unknown ? 'unknown' : 'not_queried')
          const item: ReviewTrackingPlanItem = {
            ...base,
            id: plan.id,
            kind: 'plan',
            channel: s.binding.channel,
            versionName: s.artifact.identity.versionName,
            buildNumber: s.artifact.identity.buildNumber,
            createdAt: attempt.createdAt,
            receiptCode: attempt.code,
            state,
            todo:
              s.binding.channel === 'meizu' && !attempt.reviewAnchor && state === 'not_queried'
                ? 'store_console'
                : todo(state, unknown, s.binding.channel, latest),
            querySupported:
              s.binding.channel === 'honor' ||
              (s.binding.channel === 'meizu' && !!attempt.reviewAnchor),
            observation: latest ?? null,
            appleObservation: null,
          }
          response.items.push(item)
        }
        // 3. Apple 只展示原操作和带时间的已有观察，进入菜单不会刷新远端目录。
        for (const record of apple) {
          if (!record.remoteStartedAt || !record.finishedAt) continue
          const state = observedState(record)
          // 同版本的手动发布已受理或待核对时，旧送审观察不能再次提示执行手动发布。
          const release = apple.find(
            (r) =>
              r.snapshot.action === 'release' &&
              r.snapshot.binding.appId === record.snapshot.binding.appId &&
              r.snapshot.version.id === record.snapshot.version.id &&
              r.snapshot.build.id === record.snapshot.build.id &&
              r.remoteStartedAt &&
              r.finishedAt &&
              (r.status === 'succeeded' ||
                (r.status === 'unknown' && r.reconciliation?.decision !== 'absent')),
          )
          let task = todo(state, record.status === 'unknown' && !record.reconciliation, 'app_store')
          if (
            task !== 'verify' &&
            record.observation?.state === 'PENDING_DEVELOPER_RELEASE' &&
            record.snapshot.action === 'submit'
          )
            task = release
              ? release.status === 'unknown' && !release.reconciliation
                ? 'verify'
                : 'wait'
              : 'manual_release'
          if (
            record.snapshot.action === 'release' &&
            record.status === 'succeeded' &&
            state === 'not_queried'
          )
            task = 'wait'
          const item: ReviewTrackingAppleItem = {
            ...base,
            id: record.id,
            kind: 'apple',
            channel: 'app_store',
            versionName: record.snapshot.build.version,
            buildNumber: record.snapshot.build.number,
            createdAt: record.createdAt,
            receiptCode: record.code,
            state,
            todo: task,
            querySupported: false,
            observation: null,
            appleObservation: record.observation ?? null,
          }
          response.items.push(item)
        }
      }
    }
    response.items.sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
    )
    return response
  }
}
