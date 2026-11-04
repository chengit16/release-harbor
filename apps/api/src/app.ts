/** @description 本地控制面装配，统一保护请求来源和错误投影，hosted 仍拒绝启动。 */
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
import { DomainError, type ProjectStore, type ApplicationStore } from '@release-harbor/domain'
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

/** 当前仅建立本地可信工作空间；在线身份与租户授权完成前，拒绝开启在线运行。 */
export async function createApp(
  store: ProjectStore,
  options: {
    mode?: string
    webRoot?: string
    applicationStore?: ApplicationStore
    artifacts?: ArtifactsService
    preflights?: PreflightsService
    credentialAccounts?: CredentialAccountsService
    releasePlans?: ReleasePlansService
    execution?: ReleaseExecutionService
    preparations?: ReleasePreparationsService
  } = {},
): Promise<NestFastifyApplication> {
  if (options.mode && options.mode !== 'local')
    throw new Error('在线运行尚未实现，请使用 local 模式')
  @Module({
    // 项目单元夹具可只装配旧接口；实际启动始终传入应用存储。
    imports: [
      ProjectsModule.register(store, LOCAL_WORKSPACE),
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
      ...(options.releasePlans ? [ReleasePlansModule.register(options.releasePlans)] : []),
      ...(options.credentialAccounts
        ? [CredentialAccountsModule.register(options.credentialAccounts)]
        : []),
    ],
    controllers: [ProductController],
  })
  class ApplicationModule {}
  const adapter = new FastifyAdapter({ bodyLimit: 64 * 1024 })
  const app = await NestFactory.create<NestFastifyApplication>(ApplicationModule, adapter, {
    logger: false,
  })
  const server = adapter.getInstance()
  if (options.artifacts) {
    // 原始流不启用 parseAs 缓冲；产物接收层独立限制字节数、磁盘预算和时限。
    server.addContentTypeParser('application/octet-stream', (_request, payload, done) =>
      done(null, payload),
    )
  }
  // 监听回环地址之外，同时校验 Host 和 Origin，防止本地写接口被其它站点误用。
  server.addHook('onRequest', (request, reply, done) => {
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(request.headers.host ?? '')) {
      reply.status(403).send({ statusCode: 403, message: '当前服务仅接受本机访问' })
      return
    }
    const origin = request.headers.origin
    const port = process.env.RELEASE_HARBOR_PORT || '4399'
    if (
      origin &&
      ![
        `http://127.0.0.1:${port}`,
        `http://localhost:${port}`,
        'http://127.0.0.1:5178',
        'http://localhost:5178',
      ].includes(origin)
    ) {
      reply.status(403).send({ statusCode: 403, message: '请求来源未获允许' })
      return
    }
    done()
  })
  app.setGlobalPrefix('api')
  app.useGlobalFilters(new PublicErrorFilter())
  if (options.webRoot) app.useStaticAssets({ root: options.webRoot, prefix: '/' })
  await app.init()
  await server.ready()
  return app
}
