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
import { DomainError, type ProjectStore } from '@release-harbor/domain'
import { ProjectsModule } from './projects.module.ts'

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
  options: { mode?: string; webRoot?: string } = {},
) {
  if (options.mode && options.mode !== 'local')
    throw new Error('在线运行尚未实现，请使用 local 模式')
  @Module({
    imports: [ProjectsModule.register(store, LOCAL_WORKSPACE)],
    controllers: [ProductController],
  })
  class ApplicationModule {}
  const adapter = new FastifyAdapter({ bodyLimit: 64 * 1024 })
  const app = await NestFactory.create<NestFastifyApplication>(ApplicationModule, adapter, {
    logger: false,
  })
  const server = adapter.getInstance()
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
