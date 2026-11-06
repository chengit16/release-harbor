/** @description 版本级状态查询用例；从已执行计划恢复身份，在可信 worker 只读查询，观察不修改发布与授权事实。 */
import { randomUUID } from 'node:crypto'
import { ApplicationCatalog, DomainError, planFingerprint } from '@release-harbor/domain'
import {
  isReleaseObservationResult,
  type ReleaseObservation,
  type ReleasePlan,
  type ReleaseObservationResult,
} from '@release-harbor/contracts'
import type { ReleaseObservationRunner } from '@release-harbor/runner-local'
import { FileReleasePlanStore } from './release-plan-store.ts'
import { ReleaseObservationStore } from './release-observation-store.ts'

/** 限定已尝试写入的荣耀／魅族 Android 送审计划；预检过期不阻止历史状态读取，不授予执行权。 */
export class ReleaseObservationService {
  constructor(
    private readonly applications: ApplicationCatalog,
    private readonly plans: FileReleasePlanStore,
    private readonly observations: ReleaseObservationStore,
    private readonly runner: ReleaseObservationRunner,
    private readonly now: () => number = Date.now,
  ) {}
  private async plan(
    projectId: string,
    applicationId: string,
    planId: string,
  ): Promise<ReleasePlan> {
    await this.applications.get('local', projectId, applicationId)
    const plan = (await this.plans.list('local', projectId, applicationId)).find(
      (p) => p.id === planId,
    )
    if (!plan) throw new DomainError('发布计划不存在', 404)
    return plan
  }
  /** 仅读取当前父级下计划的观察历史，失败明确报错，不查询商店。 */
  async list(
    projectId: string,
    applicationId: string,
    planId: string,
  ): Promise<ReleaseObservation[]> {
    await this.plan(projectId, applicationId, planId)
    return (await this.observations.list('local', projectId, applicationId)).filter(
      (r) => r.planId === planId,
    )
  }
  /** 审核状态菜单汇总当前应用全部已有观察，保持原查询端点的父级隔离。 */
  async applicationHistory(
    projectId: string,
    applicationId: string,
  ): Promise<ReleaseObservation[]> {
    await this.applications.get('local', projectId, applicationId)
    return this.observations.list('local', projectId, applicationId)
  }

  /** 显式查询一次；终态复用原观察，失败保留旧成功事实，查询无远端写入或重放授权。 */
  async query(
    projectId: string,
    applicationId: string,
    planId: string,
  ): Promise<ReleaseObservation> {
    // 1. 服务端恢复不可变目标；未执行、未接入渠道或配置变更均不派发查询。
    const plan = await this.plan(projectId, applicationId, planId),
      s = plan.snapshot
    if (
      !['honor', 'meizu'].includes(s.binding.channel) ||
      !['honor_submit_review', 'meizu_submit_review'].includes(s.action) ||
      s.application.platform !== 'android' ||
      !s.artifact.identity
    )
      throw new DomainError('当前仅支持荣耀／魅族 Android 已执行送审版本的状态查询', 409)
    const attempts = await this.plans.attempts('local', projectId, applicationId)
    const attempt = attempts.find((a) => a.planId === planId && a.remoteStartedAt && a.finishedAt)
    if (!attempt) throw new DomainError('请在本次发布执行结束后查询商店状态', 409)
    if (s.binding.channel === 'meizu' && !attempt.reviewAnchor)
      throw new DomainError('该魅族历史记录未保存送审版本 ID，请到魅族后台核对；无需重新提交', 409)
    const binding = (await this.applications.bindings('local', projectId, applicationId)).find(
      (b) => b.id === s.binding.id,
    )
    if (planFingerprint(binding) !== planFingerprint(s.binding))
      throw new DomainError('商店绑定已变化，请核对该历史版本对应的账号与目标', 409)
    const history = await this.list(projectId, applicationId, planId)
    const latest = history[0]
    if (latest?.code === 'observed' && ['rejected', 'published'].includes(latest.state))
      return latest
    // 2. 预约在网络前持久化，跨计划共享商店目标窗口，响应丢失和重启不自动重试。
    const requestedAt = new Date(this.now()).toISOString(),
      target = s.binding.channel + ':' + s.binding.appId
    await this.observations.reserve('local', target, requestedAt)
    let result: ReleaseObservationResult = { state: 'unknown', code: 'interrupted', rawState: null }
    try {
      const value = await this.runner.run({
        binding: s.binding,
        identifier: s.application.identifier,
        versionName: s.artifact.identity.versionName,
        buildNumber: s.artifact.identity.buildNumber,
        ...(s.binding.channel === 'meizu' ? { reviewAnchor: attempt.reviewAnchor } : {}),
      })
      result = isReleaseObservationResult(value)
        ? value
        : { state: 'unknown', code: 'invalid_response', rawState: null }
      const current = (await this.applications.bindings('local', projectId, applicationId)).find(
        (b) => b.id === s.binding.id,
      )
      if (planFingerprint(current) !== planFingerprint(s.binding))
        result = { state: 'unknown', code: 'changed', rawState: null }
    } catch {
      /* 未知查询失败不附带异常正文，旧的成功观察继续保留。 */
    }
    // 3. 新观察单独追加；成功查询保守间隔三小时，失败一分钟后允许显式再查，绝不自动查询。
    const checkedAt = new Date(Math.max(this.now(), Date.parse(requestedAt))).toISOString()
    const observation: ReleaseObservation = {
      ...result,
      id: randomUUID(),
      planId,
      projectId,
      applicationId,
      channel: s.binding.channel === 'meizu' ? 'meizu' : 'honor',
      source:
        s.binding.channel === 'meizu'
          ? 'meizu_version_detail'
          : result.state === 'published'
            ? 'honor_published_version'
            : 'honor_current_release',
      ...(attempt.reviewAnchor ? { versionId: attempt.reviewAnchor.versionId } : {}),
      versionName: s.artifact.identity.versionName,
      buildNumber: s.artifact.identity.buildNumber,
      requestedAt,
      checkedAt,
      nextQueryAt: new Date(
        Date.parse(checkedAt) + (result.code === 'observed' ? 10800000 : 60000),
      ).toISOString(),
    }
    await this.observations.finish('local', target, observation)
    return observation
  }
  /** 关闭仅结束本机只读等待，不撤销或重放发布。 */
  onModuleDestroy(): void {
    this.runner.close()
  }
}
