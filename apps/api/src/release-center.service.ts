/** @description 发布中心只读用例；从可信工作空间汇总公开列表，不请求商店、不准备计划、不产生执行授权。 */
import type {
  Application,
  AppleReviewRecord,
  ReleaseCenterAppleItem,
  BindingChannel,
  ChannelBinding,
  ReleaseBatch,
  ReleaseCenterBatchItem,
  ReleaseCenterItem,
  ReleaseCenterPlanItem,
  ReleaseCenterResponse,
  ReleaseCenterState,
  ReleasePlanView,
  ReleaseAttempt,
} from '@release-harbor/contracts'
import type { ApplicationCatalog, ProjectStore } from '@release-harbor/domain'
import type { AppleReviewService } from './apple-review.service.ts'
import type { ReleasePlansService } from './release-plans.service.ts'
import type { ReleaseBatchesService } from './release-batches.service.ts'
import type { ReleaseExecutionService } from './release-execution.service.ts'

function planState(view: ReleasePlanView, attempt?: ReleaseAttempt): ReleaseCenterState {
  if (attempt) {
    if (attempt.status === 'succeeded') return 'completed'
    if (attempt.status === 'running' || attempt.status === 'preparing') return 'processing'
    return 'attention'
  }
  if (view.plan.status === 'cancelled') return 'cancelled'
  if (!view.current) return 'attention'
  return view.plan.status === 'confirmed' ? 'awaiting_execution' : 'awaiting_confirmation'
}

function batchState(batch: ReleaseBatch, plans: ReleasePlanView[]): ReleaseCenterState {
  const revision = batch.revisions.at(-1)
  if (!revision) return 'draft'
  if (!revision.preparedAt || (revision.run && !revision.run.finishedAt)) return 'processing'
  // 混合结果不能显示成整体成功；任一失败、未知或停止项都需进入详情分别处理。
  if (revision.targets.every((target) => target.status === 'succeeded')) return 'completed'
  if (revision.targets.every((target) => target.status === 'ready') && !revision.run) {
    const expired = Date.now() >= Date.parse(revision.preparedAt) + 300000
    const invalid = revision.targets.some(
      (target) => !plans.find((view) => view.plan.id === target.planId)?.current,
    )
    return expired || invalid ? 'attention' : 'awaiting_confirmation'
  }
  return 'attention'
}

function planItem(
  view: ReleasePlanView,
  application: Application,
  projectName: string,
  attempts: ReleaseAttempt[],
): ReleaseCenterPlanItem {
  const plan = view.plan,
    attempt = attempts.find((item) => item.planId === plan.id)
  return {
    id: plan.id,
    kind: 'plan',
    projectId: application.projectId,
    projectName,
    applicationId: application.id,
    applicationName: application.name,
    platform: application.platform,
    channels: [plan.snapshot.binding.channel],
    createdAt: plan.createdAt,
    versionName: plan.snapshot.artifact.identity?.versionName ?? null,
    buildNumber: plan.snapshot.artifact.identity?.buildNumber ?? null,
    state: planState(view, attempt),
    planStatus: plan.status,
    current: view.current,
    invalidatedBy: view.invalidatedBy,
    attempt: attempt ? { status: attempt.status, code: attempt.code } : null,
  }
}

function batchItem(
  batch: ReleaseBatch,
  application: Application,
  projectName: string,
  bindings: ChannelBinding[],
  plans: ReleasePlanView[],
): ReleaseCenterBatchItem {
  const revision = batch.revisions.at(-1)
  function channel(bindingId: string): BindingChannel | null {
    const target = revision?.targets.find((item) => item.input.bindingId === bindingId)
    // 有冻结快照时优先采用历史渠道；草稿只引用当前绑定，缺失时如实显示无法还原。
    return (
      plans.find((item) => item.plan.id === target?.planId)?.plan.snapshot.binding.channel ??
      bindings.find((item) => item.id === bindingId)?.channel ??
      null
    )
  }
  const targets = revision
    ? revision.targets.map((target) => ({
        channel: channel(target.input.bindingId),
        status: target.status,
      }))
    : batch.draft.map((target) => ({
        channel: channel(target.bindingId),
        status: 'pending' as const,
      }))
  const versions =
    revision?.targets
      .map(
        (target) =>
          plans.find((item) => item.plan.id === target.planId)?.plan.snapshot.artifact.identity,
      )
      .filter((identity) => !!identity) ?? []
  const version = versions[0]
  return {
    id: batch.id,
    kind: 'batch',
    projectId: application.projectId,
    projectName,
    applicationId: application.id,
    applicationName: application.name,
    platform: application.platform,
    channels: [...new Set(targets.flatMap((target) => (target.channel ? [target.channel] : [])))],
    createdAt: batch.createdAt,
    versionName: version?.versionName ?? null,
    buildNumber: version?.buildNumber ?? null,
    state: batchState(batch, plans),
    revisionId: revision?.id ?? null,
    targets,
  }
}

/** 原始回执、观察及人工结论分开投影；不在列表读取时查询商店或延长确认期限。 */
function appleItem(
  record: AppleReviewRecord,
  application: Application,
  projectName: string,
): ReleaseCenterAppleItem {
  return {
    id: record.id,
    kind: 'apple',
    projectId: application.projectId,
    projectName,
    applicationId: application.id,
    applicationName: application.name,
    platform: 'ios',
    channels: ['app_store'],
    createdAt: record.createdAt,
    versionName: record.snapshot.build.version,
    buildNumber: record.snapshot.build.number,
    state:
      record.status === 'succeeded'
        ? 'completed'
        : record.status === 'running'
          ? 'processing'
          : record.status === 'ready' && Date.now() < Date.parse(record.expiresAt)
            ? 'awaiting_confirmation'
            : 'attention',
    action: record.snapshot.action,
    status: record.status,
    code: record.code,
    expiresAt: record.expiresAt,
    observation: record.observation ?? null,
    reconciliation: record.reconciliation ?? null,
  }
}

/** 跨项目汇总仅暴露列表摘要；详情仍由原有按项目、应用校验的接口读取。 */
export class ReleaseCenterService {
  constructor(
    private readonly projects: ProjectStore,
    private readonly applications: ApplicationCatalog,
    private readonly plans: ReleasePlansService,
    private readonly batches: ReleaseBatchesService,
    private readonly execution: ReleaseExecutionService,
    private readonly appleReview?: Pick<AppleReviewService, 'list'>,
  ) {}

  /** 工作空间由控制面固定，不读取客户端 workspaceId；任何读取失败都拒绝整次查询，避免伪造空历史。 */
  async list(workspaceId: string): Promise<ReleaseCenterResponse> {
    // 1. 只遍历可信空间的项目与应用，空历史应用仍可作为发起入口。
    const projects = await this.projects.list(workspaceId)
    const result: ReleaseCenterResponse = { projects: [], items: [] }
    for (const project of projects) {
      const applications = await this.applications.list(workspaceId, project.id)
      result.projects.push({
        id: project.id,
        name: project.name,
        applications: applications.map(({ id, name, platform }) => ({ id, name, platform })),
      })
      // 2. 复用只读有效性与回执读取；顺序遍历应用，避免大量产物复核同时占用本机资源。
      for (const application of applications) {
        const args = [workspaceId, project.id, application.id] as const
        const [plans, batches, attempts, bindings, appleReviews] = await Promise.all([
          this.plans.list(...args),
          this.batches.list(...args),
          this.execution.list(...args),
          this.applications.bindings(...args),
          application.platform === 'ios' && this.appleReview
            ? this.appleReview.list(project.id, application.id)
            : Promise.resolve([]),
        ])
        // 3. 批次只占一个列表项，全部历史 revision 的子计划都归入原批次，不重复显示单渠道记录。
        const childIds = new Set(
          batches.flatMap((batch) =>
            batch.revisions.flatMap((revision) => revision.targets.map((target) => target.planId)),
          ),
        )
        const items: ReleaseCenterItem[] = [
          ...plans
            .filter((view) => !childIds.has(view.plan.id))
            .map((view) => planItem(view, application, project.name, attempts)),
          ...batches.map((batch) => batchItem(batch, application, project.name, bindings, plans)),
          ...appleReviews.map((record) => appleItem(record, application, project.name)),
        ]
        result.items.push(...items)
      }
    }
    result.items.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
    return result
  }
}
