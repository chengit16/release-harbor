/** @description 独立在线 NestJS 装配；仅开放认证和在线目录，无本机、SDK 或商店接口。 */
import 'reflect-metadata'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import fastifyCookie from '@fastify/cookie'
import {
  Catch,
  HttpException,
  Module,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import type { FastifyReply } from 'fastify'
import type { Pool } from 'pg'
import { DomainError } from '@release-harbor/domain'
import { HOSTED_LOGIN, HOSTED_ORIGIN, HostedAuthController } from './auth.controller.ts'
import { HostedCatalogController } from './catalog.controller.ts'
import { HostedCatalog } from './catalog.ts'
import type { HostedLogin } from './oidc.ts'
import { HostedSessions } from './session-store.ts'
import { HostedArtifactsController } from './artifacts/controller.ts'
import { HostedArtifacts } from './artifacts/service.ts'
import type { HostedArtifactStorage } from './artifacts/storage.ts'

/** 在线宿主的独立依赖，不允许注册本机模块。 */
export interface HostedAppOptions {
  /** 已迁移的在线 PostgreSQL 连接池，由启动器负责关闭。 */
  pool: Pool
  /** 唯一的 HTTPS 浏览器来源；不信任转发头声明的身份。 */
  origin: URL
  /** 生产使用经发现的固定 OIDC 登录端口。 */
  login: HostedLogin
  /** 独立 Web 构建目录；仅 HTTP 测试允许省略。 */
  webRoot?: string
  /** 已验证的版本化对象存储；缺省时目录仍可运行。 */
  artifactStorage?: HostedArtifactStorage
}

@Catch()
class HostedErrors implements ExceptionFilter {
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
            : '在线服务暂时无法完成请求'
    reply.status(statusCode).send({ statusCode, message })
  }
}

/** 装配在线宿主；调用方只在回环监听并由同源 HTTPS 转发。 */
export async function createHostedApp(options: HostedAppOptions): Promise<NestFastifyApplication> {
  const html = options.webRoot
    ? await readFile(join(options.webRoot, 'index.html'), 'utf8')
    : undefined
  @Module({
    controllers: [HostedAuthController, HostedCatalogController, HostedArtifactsController],
    providers: [
      { provide: HOSTED_ORIGIN, useValue: options.origin },
      { provide: HOSTED_LOGIN, useValue: options.login },
      { provide: HostedSessions, useValue: new HostedSessions(options.pool, options.login.issuer) },
      { provide: HostedCatalog, useValue: new HostedCatalog(options.login.issuer) },
      { provide: HostedArtifacts, useValue: new HostedArtifacts(options.artifactStorage) },
    ],
  })
  class HostedModule {}

  const adapter = new FastifyAdapter({ bodyLimit: 16 * 1024, trustProxy: false })
  const app = await NestFactory.create<NestFastifyApplication>(HostedModule, adapter, {
    logger: false,
    abortOnError: false,
  })
  app.setGlobalPrefix('api/hosted')
  app.useGlobalFilters(new HostedErrors())
  await app.register(fastifyCookie)
  const server = adapter.getInstance()
  const storageOrigin = options.artifactStorage?.origin
  const connect = storageOrigin ? `connect-src 'self' ${storageOrigin}; ` : ''
  server.addHook('onRequest', (request, reply, done) => {
    // 所有页面和接口同源；回调为顶层导航，浏览器可能不发送 Origin。
    reply.header('Cache-Control', 'no-store')
    reply.header('Referrer-Policy', 'no-referrer')
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header(
      'Content-Security-Policy',
      `default-src 'self'; ${connect}style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
    )
    const { host, origin } = request.headers
    if (host !== options.origin.host || (origin && origin !== options.origin.origin)) {
      reply.status(403).send({ statusCode: 403, message: '在线请求来源未获允许' })
      return
    }
    if (
      request.method !== 'GET' &&
      request.method !== 'HEAD' &&
      (origin !== options.origin.origin || request.headers['x-release-harbor-hosted'] !== '1')
    ) {
      reply.status(403).send({ statusCode: 403, message: '缺少在线操作来源或标记' })
      return
    }
    done()
  })
  server.get('/api/hosted/health', () => ({
    mode: 'hosted',
    milestone: 'workspace',
    publishingEnabled: false,
  }))
  if (html && options.webRoot) {
    app.useStaticAssets({ root: join(options.webRoot, 'assets'), prefix: '/assets/', index: false })
    server.get('/', (_request, reply) => reply.type('text/html; charset=utf-8').send(html))
  }
  return app
}
