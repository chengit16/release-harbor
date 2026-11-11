/** @description 成员公开响应按路由投影；过滤在服务端完成，不把其他绑定、批次或凭据目录交给浏览器。 */
import { DomainError } from '@release-harbor/domain'
import type { FastifyRequest } from 'fastify'
import {
  isRecord,
  isChannelBinding,
  isReleasePlanView,
  isReleaseBatch,
  isAppleReviewRecord,
} from '@release-harbor/contracts'
import { teamCanBinding } from './access.ts'
import type { TeamAccount } from './store.ts'
import type { LocalTeamPolicy } from './policy.ts'

/** 只处理已授权的查询响应；未知投影不猜测结构或返回跨目标记录。 */
export class TeamResponseProjection {
  constructor(private readonly policy: LocalTeamPolicy) {}
  /** 返回独立对象，绝不修改服务层缓存或历史事实。
   * 长函数保留原因：逐项列出响应结构及过滤规则，未知字段不自动传播；聚合摘要已单独拆分。 */
  async filter(account: TeamAccount, request: FastifyRequest, payload: unknown): Promise<unknown> {
    if (!isRecord(payload)) return payload
    const route = request.routeOptions.url ?? ''
    const params = isRecord(request.params) ? request.params : {}
    const p = typeof params.projectId === 'string' ? params.projectId : ''
    const a = typeof params.applicationId === 'string' ? params.applicationId : ''
    if (route === '/api/projects' && Array.isArray(payload.items)) {
      const items = []
      for (const project of payload.items) {
        if (!isRecord(project) || typeof project.id !== 'string') continue
        const apps = (await this.policy.ports.applications?.list('local', project.id)) ?? []
        for (const app of apps)
          if (await this.policy.visibleApp(account, project.id, app.id)) {
            items.push(project)
            break
          }
      }
      return { ...payload, items }
    }
    if (route === '/api/projects/:projectId/applications' && Array.isArray(payload.items)) {
      const items = []
      for (const app of payload.items)
        if (
          isRecord(app) &&
          typeof app.id === 'string' &&
          (await this.policy.visibleApp(account, p, app.id))
        )
          items.push(app)
      return { ...payload, items }
    }
    if (route.endsWith('/bindings') && Array.isArray(payload.items))
      return {
        ...payload,
        items: payload.items.filter((b) => isChannelBinding(b) && this.policy.visible(account, b)),
      }
    if (
      route === '/api/profiles' &&
      isRecord(payload.catalog) &&
      Array.isArray(payload.catalog.profiles)
    ) {
      const references = new Set<string>()
      for (const grant of account.permissions?.grants ?? []) {
        const b = await this.policy
          .binding(grant.projectId, grant.applicationId, grant.bindingId)
          .catch((error: unknown) => {
            if (error instanceof DomainError && error.statusCode === 404) return undefined
            throw error
          })
        if (b && teamCanBinding(account, b)) references.add(`${b.channel}/${b.credentialReference}`)
      }
      for (const grant of account.permissions?.applications ?? []) {
        // 应用删除后残留的授权不转移范围；仅忽略不存在，存储故障仍向调用方报告。
        const bindings = await this.policy.ports.applications
          ?.bindings('local', grant.projectId, grant.applicationId)
          .catch((error: unknown) => {
            if (error instanceof DomainError && error.statusCode === 404) return []
            throw error
          })
        for (const b of bindings ?? [])
          if (teamCanBinding(account, b)) references.add(`${b.channel}/${b.credentialReference}`)
      }
      return {
        catalog: {
          ...payload.catalog,
          profiles: payload.catalog.profiles.filter(
            (v) =>
              isRecord(v) &&
              typeof v.reference === 'string' &&
              references.has(`${v.channel}/${v.reference}`),
          ),
        },
      }
    }
    if (route === '/api/store-status') {
      const targets = [],
        ids = new Set<string>()
      for (const target of Array.isArray(payload.targets) ? payload.targets : []) {
        if (
          !isRecord(target) ||
          typeof target.projectId !== 'string' ||
          typeof target.applicationId !== 'string'
        )
          continue
        const b = await this.policy
          .binding(target.projectId, target.applicationId, target.bindingId)
          .catch((error: unknown) => {
            if (error instanceof DomainError && error.statusCode === 404) return undefined
            throw error
          })
        if (b && teamCanBinding(account, b, 'review_read')) {
          targets.push(target)
          ids.add(b.id)
        }
      }
      const result: Record<string, unknown> = { targets }
      // 每一组缓存和历史都以可见绑定为界；新增未知字段默认不公开。
      for (const key of [
        'snapshots',
        'trackedSnapshots',
        'manualRecords',
        'queryHistory',
        'materialSnapshots',
      ])
        result[key] = Array.isArray(payload[key])
          ? payload[key].filter(
              (v) => isRecord(v) && typeof v.bindingId === 'string' && ids.has(v.bindingId),
            )
          : []
      return result
    }
    if (route === '/api/release-center') return this.center(account, payload)
    if (!Array.isArray(payload.items)) return payload
    if (route.endsWith('/release-plans') || route.endsWith('/apple-review')) {
      const items = []
      for (const value of payload.items) {
        const binding = isReleasePlanView(value)
          ? value.plan.snapshot.binding
          : isAppleReviewRecord(value)
            ? value.snapshot.binding
            : undefined
        if (binding && (await this.policy.visibleSnapshot(account, binding))) items.push(value)
      }
      return { ...payload, items }
    }
    if (route.endsWith('/release-batches')) {
      const items = []
      for (const b of payload.items)
        if (isReleaseBatch(b) && (await this.policy.batchAllowed(account, p, a, b))) items.push(b)
      return { ...payload, items }
    }
    if (route.endsWith('/release-attempts')) {
      const plans = (await this.policy.ports.releasePlans?.history('local', p, a)) ?? []
      const allowed = new Set<string>()
      for (const plan of plans)
        if (await this.policy.visibleSnapshot(account, plan.snapshot.binding)) allowed.add(plan.id)
      return {
        ...payload,
        items: payload.items.filter(
          (v) => isRecord(v) && typeof v.planId === 'string' && allowed.has(v.planId),
        ),
      }
    }
    if (route.endsWith('/preflights') || route.endsWith('/release-preparations')) {
      const bindings = (await this.policy.ports.applications?.bindings('local', p, a)) ?? []
      return {
        ...payload,
        items: payload.items.filter((v) => {
          if (!isRecord(v)) return false
          const record = isRecord(v.record) ? v.record : isRecord(v.input) ? v.input : v
          // 同一绑定改配后仍保留旧 ID，必须同时核对记录版本，防止新授权读到旧账号的检查和说明。
          const revision = record.bindingRevision ?? record.expectedBindingRevision
          return bindings.some(
            (b) =>
              b.id === record.bindingId && b.revision === revision && teamCanBinding(account, b),
          )
        }),
      }
    }
    return payload
  }
  private async center(account: TeamAccount, payload: Record<string, unknown>): Promise<unknown> {
    const projects = [],
      allowed = new Set<string>(),
      records = new Set<string>()
    for (const project of Array.isArray(payload.projects) ? payload.projects : []) {
      if (
        !isRecord(project) ||
        typeof project.id !== 'string' ||
        !Array.isArray(project.applications)
      )
        continue
      const applications = []
      for (const app of project.applications) {
        if (!isRecord(app) || typeof app.id !== 'string') continue
        const p = project.id,
          a = app.id
        const bindings = (await this.policy.ports.applications?.bindings('local', p, a)) ?? []
        if (!bindings.some((b) => teamCanBinding(account, b))) continue
        applications.push(app)
        allowed.add(`${p}/${a}`)
        for (const plan of (await this.policy.ports.releasePlans?.history('local', p, a)) ?? [])
          if (await this.policy.visibleSnapshot(account, plan.snapshot.binding))
            records.add(plan.id)
        for (const r of (await this.policy.ports.appleReview?.list(p, a)) ?? [])
          if (await this.policy.visibleSnapshot(account, r.snapshot.binding)) records.add(r.id)
        for (const b of (await this.policy.ports.batches?.list('local', p, a)) ?? [])
          if (await this.policy.batchAllowed(account, p, a, b)) records.add(b.id)
      }
      if (applications.length) projects.push({ ...project, applications })
    }
    return {
      projects,
      items: (Array.isArray(payload.items) ? payload.items : []).filter(
        (v) =>
          isRecord(v) &&
          allowed.has(`${v.projectId}/${v.applicationId}`) &&
          typeof v.id === 'string' &&
          records.has(v.id),
      ),
    }
  }
}
