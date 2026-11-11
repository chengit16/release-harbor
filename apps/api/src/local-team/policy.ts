/** @description 成员 HTTP 资源策略；只开放逐项列出的路由，保存的目标和当前绑定共同决定访问范围。 */
import type { FastifyRequest } from 'fastify'
import { ApplicationCatalog, DomainError, type ProjectStore } from '@release-harbor/domain'
import {
  isRecord,
  type ChannelBinding,
  type TeamOperation,
  type TeamReleaseAction,
  type LocalTeamPermissions,
  type TeamGrantOption,
} from '@release-harbor/contracts'
import type { ReleasePlansService } from '../release-plans.service.ts'
import type { ReleaseBatchesService } from '../release-batches.service.ts'
import type { ReleaseExecutionService } from '../release-execution.service.ts'
import type { AppleReviewService } from '../apple-review.service.ts'
import type { PreflightsService } from '../preflights.service.ts'
import type { ReleasePreparationsService } from '../release-preparations.service.ts'
import {
  teamApplicationGrant,
  teamBindingGrant,
  teamBindingFingerprint,
  teamCanBinding,
  teamHasMenu,
} from './access.ts'
import type { TeamAccount } from './store.ts'
import { TeamResponseProjection } from './projection.ts'

/** 只依赖安全目录和现有事实查询，不引入 worker、秘密或新发布能力。 */
export interface TeamPolicyPorts {
  projects?: ProjectStore
  applications?: ApplicationCatalog
  releasePlans?: ReleasePlansService
  batches?: ReleaseBatchesService
  execution?: ReleaseExecutionService
  appleReview?: AppleReviewService
  preflights?: PreflightsService
  preparations?: ReleasePreparationsService
}
/** 默认拒绝新路由；后台关键边界还会独立读取最新授权。 */
export class LocalTeamPolicy {
  readonly projection: TeamResponseProjection
  constructor(readonly ports: TeamPolicyPorts) {
    this.projection = new TeamResponseProjection(this)
  }

  /** 管理员按应用授权，候选同时包含尚未配置渠道的应用。 */
  async catalog(): Promise<TeamGrantOption[]> {
    const result: TeamGrantOption[] = []
    for (const project of (await this.ports.projects?.list('local')) ?? [])
      for (const app of (await this.ports.applications?.list('local', project.id)) ?? []) {
        const bindings =
          (await this.ports.applications?.bindings('local', project.id, app.id)) ?? []
        result.push({
          projectId: project.id,
          applicationId: app.id,
          label: `${project.name} / ${app.name}`,
          platform: app.platform,
          channels: bindings.map((b) => b.channel),
        })
      }
    return result
  }
  /** 应用授权检查真实归属；兼容的旧渠道授权仍复核指纹。 */
  async validatePermissions(value: LocalTeamPermissions): Promise<void> {
    for (const grant of value.applications ?? []) {
      if (!this.ports.applications) throw new DomainError('应用目录尚未就绪', 503)
      await this.ports.applications.get('local', grant.projectId, grant.applicationId)
    }
    for (const grant of value.grants) {
      const binding = await this.binding(grant.projectId, grant.applicationId, grant.bindingId)
      if (teamBindingFingerprint(binding) !== grant.fingerprint)
        throw new DomainError('渠道配置已变化，请刷新后重新授权', 409)
    }
  }
  /** 授权候选仅由管理员端点读取，返回公开配置及对应指纹。 */
  async binding(p: string, a: string, id: unknown): Promise<ChannelBinding> {
    const binding = (await this.ports.applications?.bindings('local', p, a))?.find(
      (b) => b.id === id,
    )
    if (!binding) throw new DomainError('商店绑定不存在', 404)
    return binding
  }
  /** 应用目录可服务于三个菜单；审核缓存仍必须显式开放。 */
  visible(account: TeamAccount, binding: ChannelBinding): boolean {
    return (
      !!teamBindingGrant(account, binding) &&
      (teamHasMenu(account, 'projects') ||
        teamHasMenu(account, 'releases') ||
        teamCanBinding(account, binding, 'review_read'))
    )
  }
  /** 应用授权允许预先分配未配置渠道的应用；旧授权仍从有效绑定恢复范围。 */
  async visibleApp(account: TeamAccount, p: string, a: string): Promise<boolean> {
    if (
      teamApplicationGrant(account, p, a) &&
      (teamHasMenu(account, 'projects') ||
        teamHasMenu(account, 'releases') ||
        teamHasMenu(account, 'reviews'))
    )
      return true
    return (
      (await this.ports.applications?.bindings('local', p, a))?.some((b) =>
        this.visible(account, b),
      ) ?? false
    )
  }
  /** 保存的批次全部历史范围均需可读，不能通过新草稿隐藏越界的历史版本。 */
  async batchAllowed(
    account: TeamAccount,
    p: string,
    a: string,
    batch: {
      draft: { bindingId: string; expectedBindingRevision?: number }[]
      revisions: { targets: { input: { bindingId: string; expectedBindingRevision?: number } }[] }[]
    },
    operation?: TeamOperation,
  ): Promise<boolean> {
    const targets = [
      ...batch.draft,
      ...batch.revisions.flatMap((r) => r.targets.map((t) => t.input)),
    ]
    if (!targets.length) return false
    const bindings = (await this.ports.applications?.bindings('local', p, a)) ?? []
    return targets.every((t) => {
      const b = bindings.find((b) => b.id === t.bindingId)
      return (
        b &&
        (t.expectedBindingRevision === undefined || t.expectedBindingRevision === b.revision) &&
        teamCanBinding(account, b, operation)
      )
    })
  }
  /** 历史快照只能投影到仍匹配的当前绑定，改绑后旧目标不延续成员权限。 */
  async visibleSnapshot(account: TeamAccount, binding: ChannelBinding): Promise<boolean> {
    const current = await this.binding(binding.projectId, binding.applicationId, binding.id).catch(
      (error: unknown) => {
        if (error instanceof DomainError && error.statusCode === 404) return undefined
        throw error
      },
    )
    return (
      !!current &&
      teamBindingFingerprint(current) === teamBindingFingerprint(binding) &&
      teamCanBinding(account, current)
    )
  }
  /** 计划、尝试必须通过持久化快照恢复绑定，拒绝信任正文提供的绑定覆盖。 */
  async planBinding(p: string, a: string, id: string): Promise<ChannelBinding> {
    const plan = (await this.ports.releasePlans?.history('local', p, a))?.find((v) => v.id === id)
    if (!plan) throw new DomainError('发布计划不存在', 404)
    return plan.snapshot.binding
  }
  /** 在 body 解析之后、Controller 执行之前检查资源、菜单和动作。 */
  async authorize(account: TeamAccount, request: FastifyRequest): Promise<void> {
    const route = request.routeOptions.url ?? '',
      get = request.method === 'GET'
    const params = isRecord(request.params) ? request.params : {}
    const p = text(params.projectId),
      a = text(params.applicationId),
      id = text(params.id ?? params.planId)
    // 1. 全局目录及支持入口逐项开放，其他管理路由默认拒绝。
    if (route === '/api/team/logout') return
    if (
      get &&
      route === '/api/projects' &&
      account.permissions?.menus.some((m) => ['projects', 'reviews', 'releases'].includes(m))
    )
      return
    if (
      get &&
      ['/api/channels', '/api/issues', '/api/issues/:id'].includes(route) &&
      teamHasMenu(account, 'help')
    )
      return
    if (get && route === '/api/store-status' && teamHasMenu(account, 'reviews')) return
    if (get && route === '/api/release-center' && teamHasMenu(account, 'releases')) return
    if (get && route === '/api/profiles' && teamHasMenu(account, 'releases')) return
    // 2. 审核查询要求缓存可见及独立动作，不能借查询接口改写目标。
    if (route.startsWith('/api/store-status/')) {
      this.require(request.method === 'POST')
      this.require(
        ['query', 'materials', 'manual'].some(
          (name) => route === `/api/store-status/:projectId/:applicationId/:bindingId/${name}`,
        ),
      )
      this.require(teamHasMenu(account, 'reviews'))
      const operation = route.endsWith('/manual') ? 'release_reconcile' : 'review_query'
      const binding = await this.binding(p, a, params.bindingId)
      this.require(teamCanBinding(account, binding, 'review_read'))
      this.require(
        operation === 'release_reconcile'
          ? !!teamBindingGrant(account, binding)?.operations.includes(operation)
          : teamCanBinding(account, binding, operation),
      )
      return
    }
    // 3. 父级应用范围恢复后才进入发布策略，裸资源 ID 不构成访问资格。
    if (get && route === '/api/projects/:id') {
      const apps = (await this.ports.applications?.list('local', id)) ?? []
      for (const app of apps) if (await this.visibleApp(account, id, app.id)) return
      this.require(false)
    }
    if (!route.startsWith('/api/projects/:projectId/applications')) this.require(false)
    if (
      get &&
      route === '/api/projects/:projectId/applications' &&
      account.permissions?.menus.some((m) => ['projects', 'reviews', 'releases'].includes(m))
    )
      return
    this.require(!!a && (await this.visibleApp(account, p, a)))
    const root = '/api/projects/:projectId/applications/:applicationId'
    if (get && [root, root + '/bindings'].includes(route)) return
    await this.authorizeRelease(account, request, p, a, id, root)
  }

  private async authorizeRelease(
    account: TeamAccount,
    request: FastifyRequest,
    p: string,
    a: string,
    id: string,
    root: string,
  ): Promise<void> {
    const route = request.routeOptions.url ?? ''
    const get = request.method === 'GET'
    const body = isRecord(request.body) ? request.body : {}
    this.require(teamHasMenu(account, 'releases'))
    const tail = route.slice(root.length)
    if (!get && typeof body.requestId === 'string')
      await this.authorizeReplay(account, p, a, tail, body.requestId)
    if (
      get &&
      [
        '/artifacts',
        '/artifacts/:artifactId',
        '/preflights',
        '/release-plans',
        '/release-preparations',
        '/release-attempts',
        '/apple-review',
        '/release-batches',
      ].includes(tail)
    )
      return
    if (tail.startsWith('/release-batches')) {
      this.require(
        (get && tail === '/release-batches/:id') ||
          (request.method === 'PUT' && tail === '/release-batches/:id') ||
          (request.method === 'POST' &&
            [
              '/release-batches',
              '/release-batches/:id/prepare',
              '/release-batches/:id/revisions/:rid/confirm-and-start',
              '/release-batches/:id/runs/:runId/stop',
            ].includes(tail)),
      )
      // 批次编辑与历史在同一资源中，任一旧目标越界也拒绝整个详情及确认。
      const batch = id ? await this.ports.batches?.get('local', p, a, id) : undefined
      if (batch)
        this.require(
          await this.batchAllowed(
            account,
            p,
            a,
            batch,
            get
              ? undefined
              : tail.includes('/confirm-') || tail.endsWith('/stop')
                ? 'release_confirm'
                : 'release_prepare',
          ),
        )
      if (get && tail === '/release-batches/:id') return
      this.require(!get && (request.method === 'POST' || request.method === 'PUT'))
      if (Array.isArray(body.targets)) {
        this.require(body.targets.length > 0)
        for (const target of body.targets) {
          this.require(isRecord(target))
          this.require(
            teamCanBinding(
              account,
              await this.binding(p, a, isRecord(target) ? target.bindingId : undefined),
              'release_prepare',
            ),
          )
        }
      }
      return
    }
    if (get && tail === '/release-plans/:planId/observations') {
      this.require(await this.visibleSnapshot(account, await this.planBinding(p, a, id)))
      return
    }
    this.require(request.method === 'POST')
    if (tail === '/artifacts') {
      const bindings = (await this.ports.applications?.bindings('local', p, a)) ?? []
      this.require(bindings.some((b) => teamCanBinding(account, b, 'release_prepare')))
      return
    }
    await this.authorizeMutation(account, p, a, id, tail, body)
  }

  /** 幂等写响应也可能返回旧快照；改绑后重新授权不能借旧请求编号读取旧账号事实。 */
  private async authorizeReplay(
    account: TeamAccount,
    p: string,
    a: string,
    tail: string,
    requestId: string,
  ): Promise<void> {
    if (tail === '/release-plans') {
      const old = (await this.ports.releasePlans?.history('local', p, a))?.find(
        (v) => v.requestId === requestId,
      )
      if (old) this.require(await this.visibleSnapshot(account, old.snapshot.binding))
    } else if (tail === '/apple-review/prepare') {
      const old = (await this.ports.appleReview?.list(p, a))?.find((v) => v.requestId === requestId)
      if (old) this.require(await this.visibleSnapshot(account, old.snapshot.binding))
    } else if (tail === '/release-batches') {
      const old = (await this.ports.batches?.list('local', p, a))?.find(
        (v) => v.requestId === requestId,
      )
      if (old) this.require(await this.batchAllowed(account, p, a, old))
    } else if (tail === '/release-preparations') {
      const old = (await this.ports.preparations?.list('local', p, a))?.find(
        (v) => v.id === requestId,
      )
      if (old) {
        const current = await this.binding(p, a, old.input.bindingId)
        this.require(current.revision === old.input.expectedBindingRevision)
      }
    }
  }

  private async authorizeMutation(
    account: TeamAccount,
    p: string,
    a: string,
    id: string,
    tail: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    let binding: ChannelBinding | undefined,
      operation: TeamOperation | undefined,
      action: TeamReleaseAction | undefined
    if (
      [
        '/release-preparations',
        '/preflights',
        '/apple-review/catalog',
        '/apple-review/prepare',
      ].includes(tail)
    ) {
      binding = await this.binding(p, a, body.bindingId)
      operation = 'release_prepare'
      if (tail === '/apple-review/prepare')
        action = body.action === 'release' ? 'apple_release' : 'apple_submit_review'
    } else if (tail === '/release-plans') {
      const check = await this.ports.preflights?.record('local', p, a, text(body.preflightId))
      binding = await this.binding(p, a, check?.bindingId)
      operation = 'release_prepare'
    } else if (
      /^\/release-plans\/:(id|planId)\/(confirm|execute|confirm-and-execute|cancel|observations)$/.test(
        tail,
      )
    ) {
      binding = await this.planBinding(p, a, id)
      operation = tail.endsWith('/observations') ? 'review_query' : 'release_confirm'
    } else if (tail === '/release-attempts/:id/reconcile') {
      const attempt = (await this.ports.execution?.list('local', p, a))?.find((v) => v.id === id)
      binding = await this.planBinding(p, a, attempt?.planId ?? '')
      operation = 'release_reconcile'
      action = undefined
    } else if (['/apple-review/:id/execute', '/apple-review/:id/reconcile'].includes(tail)) {
      const record = (await this.ports.appleReview?.list(p, a))?.find((r) => r.id === id)
      binding = record?.snapshot.binding
      operation = tail.endsWith('/execute') ? 'release_confirm' : 'release_reconcile'
      action = tail.endsWith('/execute')
        ? record?.snapshot.action === 'release'
          ? 'apple_release'
          : 'apple_submit_review'
        : undefined
    }
    this.require(!!binding && !!operation && teamCanBinding(account, binding, operation, action))
    const current = await this.binding(p, a, binding.id)
    this.require(teamBindingFingerprint(current) === teamBindingFingerprint(binding))
  }
  private require(allowed: boolean): asserts allowed {
    if (!allowed) throw new DomainError('当前成员没有此资源或操作的权限', 403)
  }
}
function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
