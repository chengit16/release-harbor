/** @description 管理日志及发布操作者的只读查询；用不可变事实复核跨文件审计，绝不请求商店。 */
import {
  isRecord,
  isBatchTime,
  isPlanId,
  teamAuditActions,
  type TeamAuditFilter,
  type TeamAuditPage,
  type TeamAuditEvent,
} from '@release-harbor/contracts'
import { DomainError } from '@release-harbor/domain'
import type { LocalTeamPolicy } from './policy.ts'
import type { LocalTeamStore, TeamAccount } from './store.ts'
import { releaseAuditFacts, type ReleaseAuditState } from './release-audit-facts.ts'
import { teamHasMenu } from './access.ts'

/** 同安装范围内的安全事件，完整列表仅管理员，记录详情沿用当前目标范围。 */
export class TeamAuditQuery {
  constructor(
    private readonly store: LocalTeamStore,
    private readonly policy?: LocalTeamPolicy,
  ) {}

  /** 管理员全量日志支持安全分页过滤，损坏目录不会伪装成空日志。 */
  async list(input: unknown): Promise<TeamAuditPage> {
    // 1. 先限定查询条件；管理变更只取公开前后范围，发布资料不会进入事件。
    const filter = auditFilter(input)
    const logs = await this.store.audit()
    const states = new Map<
      string,
      {
        facts: Map<string, ReturnType<typeof releaseAuditFacts>[number]>
        links: Map<string, string>
      }
    >()
    const items = []
    for (const entry of logs) {
      const e = entry.event
      if (
        (filter.memberId &&
          e.actor.id !== filter.memberId &&
          e.member?.after.id !== filter.memberId) ||
        (filter.applicationId && !eventHasApplication(e, filter.applicationId)) ||
        (filter.action && e.action !== filter.action) ||
        (filter.from && e.at < filter.from) ||
        (filter.to && e.at > filter.to)
      )
        continue
      if (!e.target) {
        items.push(e)
        continue
      }
      // 2. 每应用只建立一次证据索引；恢复缺失或提交失败不能靠相同输入认领事件。
      const key = e.target.projectId + '/' + e.target.applicationId
      let state = states.get(key)
      if (!state) {
        const source = await this.state(e.target.projectId, e.target.applicationId)
        state = {
          facts: new Map(releaseAuditFacts(source).map((f) => [f.evidence, f])),
          links: new Map(source.auditLinks?.map((link) => [link.id, link.evidence])),
        }
        states.set(key, state)
      }
      const fact =
        entry.evidence && state.links.get(e.id) === entry.evidence
          ? state.facts.get(entry.evidence)
          : undefined
      items.push({
        ...e,
        state: fact ? ('matched' as const) : ('unmatched' as const),
        outcome: fact?.outcome ?? null,
      })
    }
    // 3. 过滤后分页，避免先截断再筛选而遗漏历史。
    const page = filter.page ?? 1
    return { items: items.reverse().slice((page - 1) * 50, page * 50), total: items.length, page }
  }

  /** 成员只读当前有资格查看的原记录；批次同时带回其子计划的尝试及人工核对。 */
  async record(
    account: TeamAccount,
    p: string,
    a: string,
    kind: string,
    id: string,
    query: unknown = {},
  ): Promise<TeamAuditPage> {
    // 1. 从可信业务记录恢复目标，裸 ID 和浏览器筛选不能产生访问资格。
    if (![p, a, id].every(isPlanId) || !['plan', 'batch', 'apple'].includes(kind))
      throw new DomainError('审计记录定位不正确')
    const page = auditFilter(query).page ?? 1
    const state = await this.state(p, a)
    const plan = state.plans.find((r) => r.id === id)
    const batch = state.batches.find((r) => r.id === id)
    const apple = state.appleReviews.find((r) => r.id === id)
    if (!(kind === 'plan' ? plan : kind === 'batch' ? batch : apple))
      throw new DomainError('发布记录不存在', 404)
    if (account.role !== 'admin') {
      const binding = kind === 'plan' ? plan?.snapshot.binding : apple?.snapshot.binding
      const allowed =
        teamHasMenu(account, 'releases') &&
        (kind === 'batch'
          ? !!batch && !!(await this.policy?.batchAllowed(account, p, a, batch))
          : !!binding && !!(await this.policy?.visibleSnapshot(account, binding)))
      if (!allowed) throw new DomainError('当前成员没有此发布记录的权限', 403)
    }
    // 2. 批次关联仅包含原目标的子计划，当前账号必须先通过整组范围核验。
    const planIds = new Set(
      batch?.revisions.flatMap((r) => r.targets.flatMap((t) => (t.planId ? [t.planId] : []))) ?? [],
    )
    const facts = new Map(releaseAuditFacts(state).map((f) => [f.evidence, f]))
    const links = new Map(state.auditLinks?.map((link) => [link.id, link.evidence]))
    const logs = await this.store.audit()
    const items = logs.flatMap((entry) => {
      const target = entry.event.target
      if (
        !target ||
        target.projectId !== p ||
        target.applicationId !== a ||
        !(
          (target.kind === kind && target.recordId === id) ||
          (kind === 'batch' && target.kind === 'plan' && planIds.has(target.recordId))
        )
      )
        return []
      const fact =
        entry.evidence && links.get(entry.event.id) === entry.evidence
          ? facts.get(entry.evidence)
          : undefined
      // 只有与原业务事实匹配的事件才可显示为原准备人／确认人，孤立意图只在管理员日志可见。
      return fact ? [{ ...entry.event, state: 'matched' as const, outcome: fact.outcome }] : []
    })
    // 3. 只返回已提交且证据匹配的身份；无身份历史由页面明确呈现。
    return { items: items.reverse().slice((page - 1) * 50, page * 50), total: items.length, page }
  }

  private async state(p: string, a: string): Promise<ReleaseAuditState> {
    const ports = this.policy?.ports
    // 应用删除后仍保留安装日志；仅缺失资源视为无法匹配，存储故障仍明确报错。
    const existing = <T>(promise: Promise<T[]> | undefined): Promise<T[]> =>
      (promise ?? Promise.resolve([])).catch((error: unknown) => {
        if (error instanceof DomainError && error.statusCode === 404) return []
        throw error
      })
    const [plans, attempts, batches, appleReviews, auditLinks] = await Promise.all([
      existing(ports?.releasePlans?.history('local', p, a)),
      existing(ports?.execution?.list('local', p, a)),
      existing(ports?.batches?.list('local', p, a)),
      existing(ports?.appleReview?.list(p, a)),
      ports?.releasePlans?.auditLinks() ?? [],
    ])
    return { plans, attempts, batches, appleReviews, auditLinks }
  }
}
/** HTTP 筛选严格拒绝未知字段、反向时间和非规范页码。 */
export function auditFilter(input: unknown): TeamAuditFilter {
  if (
    !isRecord(input) ||
    Object.keys(input).some(
      (k) => !['memberId', 'applicationId', 'action', 'from', 'to', 'page'].includes(k),
    )
  )
    throw new DomainError('审计筛选字段不正确')
  if (
    [input.memberId, input.applicationId].some((v) => v !== undefined && !isPlanId(v)) ||
    (input.action !== undefined &&
      (typeof input.action !== 'string' || !Object.hasOwn(teamAuditActions, input.action))) ||
    [input.from, input.to].some((v) => v !== undefined && !isBatchTime(v)) ||
    (typeof input.from === 'string' && typeof input.to === 'string' && input.from > input.to) ||
    (input.page !== undefined &&
      (typeof input.page !== 'string' || !/^[1-9]\d{0,5}$/.test(input.page)))
  )
    throw new DomainError('审计筛选值不正确')
  const filter: TeamAuditFilter = { page: input.page === undefined ? 1 : Number(input.page) }
  if (typeof input.memberId === 'string') filter.memberId = input.memberId
  if (typeof input.applicationId === 'string') filter.applicationId = input.applicationId
  if (typeof input.from === 'string') filter.from = input.from
  if (typeof input.to === 'string') filter.to = input.to
  for (const action of Object.keys(teamAuditActions) as (keyof typeof teamAuditActions)[])
    if (action === input.action) filter.action = action
  return filter
}

function eventHasApplication(event: TeamAuditEvent, applicationId: string): boolean {
  if (event.target?.applicationId === applicationId) return true
  return [event.member?.before, event.member?.after].some(
    (m) =>
      m?.permissions?.applications?.some((g) => g.applicationId === applicationId) ||
      m?.permissions?.grants.some((g) => g.applicationId === applicationId),
  )
}
