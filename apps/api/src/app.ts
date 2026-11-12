/** @description 本机控制面装配，统一保护回环与指定隧道来源，hosted 仍拒绝启动。 */
import { workbenchOrigins } from './workbench-origins.ts'
import type { WorkbenchTunnel } from '../../../scripts/workbench-tunnel.ts'
import { LocalProductivityModule } from './local-productivity.module.ts'
import type { LocalProductivityService } from './local-productivity.service.ts'
import { LocalEfficiencyModule } from './local-efficiency.module.ts'
import type { LocalEfficiencyService } from './local-efficiency.service.ts'
import { ReleaseBatchesModule } from './release-batches.module.ts'
import type { ReleaseBatchesService } from './release-batches.service.ts'
import { AppleReviewModule } from './apple-review.module.ts'
import type { AppleReviewService } from './apple-review.service.ts'
import { join } from 'node:path'
import { IssuesService } from './issues.service.ts'
import { IssuesModule } from './issues.module.ts'
import 'reflect-metadata'
import {
  ArgumentsHost,
  Catch,
  Controller,
  ExceptionFilter,
  Get,
  HttpException,
  Module,
} from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import type { FastifyReply } from 'fastify'
import { channelCapabilities, type ProductStatus } from '@release-harbor/contracts'
import {
  ApplicationCatalog,
  DomainError,
  type ProjectStore,
  type ApplicationStore,
} from '@release-harbor/domain'
import { ProjectsModule } from './projects.module.ts'
import { ApplicationsModule } from './applications.module.ts'
import { ArtifactsModule } from './artifacts.module.ts'
import type { ArtifactsService } from './artifacts.service.ts'
import { PreflightsModule } from './preflights.module.ts'
import type { PreflightsService } from './preflights.service.ts'
import { CredentialAccountsModule } from './credential-accounts.module.ts'
import type { CredentialAccountsService } from './credential-accounts.service.ts'
import { ReleasePlansModule } from './release-plans.module.ts'
import type { ReleasePlansService } from './release-plans.service.ts'

import { ReleaseExecutionModule } from './release-execution.module.ts'
import type { ReleaseExecutionService } from './release-execution.service.ts'

import { ReleasePreparationsModule } from './release-preparations.module.ts'
import type { ReleasePreparationsService } from './release-preparations.service.ts'
import { ReviewTrackingModule } from './review-tracking.module.ts'
import { ReviewTrackingService } from './review-tracking.service.ts'
import { ReleaseObservationModule } from './release-observation.module.ts'
import type { ReleaseObservationService } from './release-observation.service.ts'
import { ReleaseCenterModule } from './release-center.module.ts'
import { ReleaseCenterService } from './release-center.service.ts'
import { StoreStatusModule } from './store-status.module.ts'
import type { StoreStatusService } from './store-status.service.ts'
import { LocalTeamModule } from './local-team/team.module.ts'
import { LocalTeamPolicy } from './local-team/policy.ts'
import { LocalTeamRuntime } from './local-team/runtime.ts'
import type { LocalTeamStore } from './local-team/store.ts'

const LOCAL_WORKSPACE = 'local'
@Controller()
class ProductController {
  @Get('health')
  health(): ProductStatus {
    return {
      product: 'release-harbor',
      mode: 'local',
      milestone: 'foundation',
      publishingEnabled: false,
      workspaceId: LOCAL_WORKSPACE,
    }
  }
  @Get('channels')
  channels() {
    return { items: channelCapabilities }
  }
}
@Catch()
class PublicErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const reply = host.switchToHttp().getResponse<FastifyReply>()
    const statusCode =
      error instanceof DomainError
        ? error.statusCode
        : error instanceof HttpException
          ? error.getStatus()
          : 500
    const message =
      error instanceof DomainError
        ? error.message
        : statusCode === 404
          ? '接口不存在'
          : statusCode < 500
            ? '请求格式不正确'
            : '服务暂时无法完成请求'
    reply.status(statusCode).send({ statusCode, message })
  }
}

/** 装配本机工作空间；隧道仅接收精确 Host，且业务必须经过团队会话边界。 */
export async function createApp(
  store: ProjectStore,
  options: {
    productivity?: LocalProductivityService
    localEfficiency?: LocalEfficiencyService
    issues?: IssuesService
    mode?: string
    webRoot?: string
    applicationStore?: ApplicationStore
    artifacts?: ArtifactsService
    preflights?: PreflightsService
    credentialAccounts?: CredentialAccountsService
    observations?: ReleaseObservationService
    appleReview?: AppleReviewService
    releasePlans?: ReleasePlansService
    execution?: ReleaseExecutionService
    batches?: ReleaseBatchesService
    preparations?: ReleasePreparationsService
    storeStatus?: StoreStatusService
    team?: LocalTeamStore
    tunnel?: WorkbenchTunnel
    port?: number
  } = {},
): Promise<NestFastifyApplication> {
  if (options.mode && options.mode !== 'local')
    throw new Error('在线运行尚未实现，请使用 local 模式')
  const port = options.port ?? Number(process.env.RELEASE_HARBOR_PORT || 4399)
  const tunnel = options.tunnel
  const team = new LocalTeamRuntime(
    port,
    options.team,
    new LocalTeamPolicy({
      ...options,
      projects: store,
      applications: options.applicationStore
        ? new ApplicationCatalog(store, options.applicationStore)
        : undefined,
    }),
    tunnel,
  )
  @Module({
    // 项目单元夹具可只装配旧接口；实际启动始终传入应用存储。
    imports: [
      LocalTeamModule.register(team),
      ...(options.productivity && options.localEfficiency
        ? [LocalProductivityModule.register(options.productivity)]
        : []),
      ...(options.localEfficiency ? [LocalEfficiencyModule.register(options.localEfficiency)] : []),
      ...(options.applicationStore && options.releasePlans && options.batches && options.execution
        ? [
            ReleaseCenterModule.register(
              new ReleaseCenterService(
                store,
                new ApplicationCatalog(store, options.applicationStore),
                options.releasePlans,
                options.batches,
                options.execution,
                options.appleReview,
              ),
            ),
          ]
        : []),
      ...(options.applicationStore &&
      options.releasePlans &&
      options.execution &&
      options.observations
        ? [
            ReviewTrackingModule.register(
              new ReviewTrackingService(
                store,
                new ApplicationCatalog(store, options.applicationStore),
                options.releasePlans,
                options.execution,
                options.observations,
                options.appleReview,
              ),
            ),
          ]
        : []),
      ...(options.storeStatus ? [StoreStatusModule.register(options.storeStatus)] : []),
      ...(options.batches && options.releasePlans
        ? [ReleaseBatchesModule.register(options.batches, options.releasePlans)]
        : []),
      ...(options.observations && options.releasePlans
        ? [ReleaseObservationModule.register(options.observations, options.releasePlans)]
        : []),
      ProjectsModule.register(store, LOCAL_WORKSPACE),
      IssuesModule.register(
        options.issues ??
          (options.webRoot
            ? new IssuesService(
                join(options.webRoot, 'knowledge/catalog.json'),
                join(options.webRoot, 'knowledge/documents'),
              )
            : new IssuesService()),
      ),
      ...(options.preparations && options.releasePlans
        ? [ReleasePreparationsModule.register(options.preparations, options.releasePlans)]
        : []),
      ...(options.execution && options.releasePlans
        ? [ReleaseExecutionModule.register(options.execution, options.releasePlans)]
        : []),
      ...(options.applicationStore
        ? [ApplicationsModule.register(store, options.applicationStore, LOCAL_WORKSPACE)]
        : []),
      ...(options.artifacts ? [ArtifactsModule.register(options.artifacts)] : []),
      ...(options.preflights ? [PreflightsModule.register(options.preflights)] : []),
      ...(options.appleReview && options.releasePlans
        ? [AppleReviewModule.register(options.appleReview, options.releasePlans)]
        : []),
      ...(options.releasePlans ? [ReleasePlansModule.register(options.releasePlans)] : []),
      ...(options.credentialAccounts
        ? [CredentialAccountsModule.register(options.credentialAccounts)]
        : []),
    ],
    controllers: [ProductController],
  })
  class ApplicationModule {}
  const adapter = new FastifyAdapter({ bodyLimit: 512 * 1024 })
  const app = await NestFactory.create<NestFastifyApplication>(ApplicationModule, adapter, {
    logger: false,
  })
  const server = adapter.getInstance()
  if (options.localEfficiency) {
    // RouteConfig 属于用户配置元数据，不会设置 Fastify 顶层 bodyLimit；仅导入路由放宽。
    server.addHook('onRoute', (route) => {
      if (route.method === 'POST' && route.url === '/api/local/restore-preview')
        route.bodyLimit = 70 * 1024 * 1024
    })
  }
  if (options.artifacts) {
    // 原始流不启用 parseAs 缓冲；产物接收层独立限制字节数、磁盘预算和时限。
    server.addContentTypeParser('application/octet-stream', (_request, payload, done) =>
      done(null, payload),
    )
  }
  // 普通回环和隧道分别核对来源；不根据任意 Host、Origin 或转发头建立信任。
  const localOrigins = workbenchOrigins(port)
  server.addHook('onRequest', (request, reply, done) => {
    const host = request.headers.host
    const tunnelOrigin = tunnel && host === tunnel.host ? tunnel.origin : undefined
    if (!tunnelOrigin && !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host ?? '')) {
      reply.status(403).send({
        statusCode: 403,
        message: '当前服务仅接受本机或已配置的 HTTPS 隧道域名访问',
      })
      return
    }
    const origin = request.headers.origin
    if (
      origin !== undefined &&
      !(tunnelOrigin ? origin === tunnelOrigin : localOrigins.includes(origin))
    ) {
      reply.status(403).send({
        statusCode: 403,
        message:
          origin === tunnel?.origin ? '请将 HTTPS 隧道设为保留原始 Host' : '请求来源未获允许',
      })
      return
    }
    done()
  })
  team.install(server)
  if (options.localEfficiency) {
    const local = options.localEfficiency
    const counted = new WeakSet<object>()
    const sending = new WeakSet<object>()
    const release = (request: object): void => {
      if (counted.delete(request)) local.maintenance.requests--
    }
    server.addHook('onRequest', async (request, reply) => {
      if (!request.url.startsWith('/api/')) return
      reply.header('Cache-Control', 'no-store')
      if (
        local.maintenance.locked ||
        (local.maintenance.restarting &&
          !(request.method === 'GET' && request.url === '/api/local'))
      ) {
        reply.status(409).send({ statusCode: 409, message: '本机正在维护或恢复，请稍后刷新' })
        return
      }
      local.maintenance.requests++
      counted.add(request)
      // 离页可能只关闭响应而不触发 onResponse；处理尚未结束时仍持有占用，不能提前开放维护。
      reply.raw.once('close', () => {
        if (sending.has(request)) release(request)
      })
      if (request.method === 'POST' && request.url.includes('local-credential-sessions'))
        local.accountSession()
    })
    server.addHook('onSend', async (request, reply, payload) => {
      // 处理和序列化完成后才允许关闭路径释放；流响应继续等传输终止，正常响应与中断只扣减一次。
      sending.add(request)
      if (reply.raw.destroyed) release(request)
      return payload
    })
    server.addHook('onResponse', async (request) => release(request))
  }
  app.setGlobalPrefix('api')
  app.useGlobalFilters(new PublicErrorFilter())
  if (options.webRoot) app.useStaticAssets({ root: options.webRoot, prefix: '/' })
  await app.init()
  await server.ready()
  return app
}
