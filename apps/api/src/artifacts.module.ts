/** @description 产物 HTTP 边界，公开接口只接受原始字节与安全文件元数据。 */
import { Controller, Get, HttpCode, Inject, Module, Param, Post, Req } from '@nestjs/common'
import type { DynamicModule } from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import { Readable } from 'node:stream'
import { artifactLimits, type ArtifactRecord } from '@release-harbor/contracts'
import { DomainError } from '@release-harbor/domain'
import { ArtifactsService } from './artifacts.service.ts'

@Controller('projects/:projectId/applications/:applicationId/artifacts')
class ArtifactsController {
  constructor(@Inject(ArtifactsService) private readonly artifacts: ArtifactsService) {}

  /** 仅查询本地可信工作空间下的应用产物。 */
  @Get()
  async list(
    @Param('projectId') projectId: string,
    @Param('applicationId') applicationId: string,
  ): Promise<{ items: ArtifactRecord[] }> {
    return { items: await this.artifacts.list('local', projectId, applicationId) }
  }

  /** 所有父级归属同时核对，不能通过裸产物 ID 越权读取。 */
  @Get(':artifactId')
  async get(
    @Param('projectId') projectId: string,
    @Param('applicationId') applicationId: string,
    @Param('artifactId') artifactId: string,
  ): Promise<{ artifact: ArtifactRecord }> {
    return { artifact: await this.artifacts.get('local', projectId, applicationId, artifactId) }
  }

  /** 202 表示接收完成且已登记检查；检查结果必须继续读取记录。 */
  @Post()
  @HttpCode(202)
  async receive(
    @Param('projectId') projectId: string,
    @Param('applicationId') applicationId: string,
    @Req() request: FastifyRequest,
  ): Promise<{ artifact: ArtifactRecord }> {
    try {
      if (
        request.headers['content-encoding'] ||
        request.headers['content-type'] !== 'application/octet-stream'
      )
        throw new DomainError('只接受未压缩的原始安装包字节', 415)
      const name = request.headers['x-artifact-name']
      const size = request.headers['x-artifact-size']
      if (typeof name !== 'string' || typeof size !== 'string' || !/^[1-9][0-9]{0,10}$/.test(size))
        throw new DomainError('请提供合法文件名与字节数')
      let fileName: string
      try {
        fileName = decodeURIComponent(name)
      } catch {
        throw new DomainError('文件名编码不正确')
      }
      const expected = Number(size)
      if (expected > artifactLimits.maxFileBytes)
        throw new DomainError('安装包超过单文件 256 MiB 限制', 413)
      if (
        request.headers['content-length'] &&
        Number(request.headers['content-length']) !== expected
      )
        throw new DomainError('文件声明大小与请求长度不一致')
      return {
        artifact: await this.artifacts.receive(
          'local',
          projectId,
          applicationId,
          fileName,
          expected,
          request.body,
        ),
      }
    } finally {
      // 在字段或归属拒绝时释放未消费的流，不将剩余文件缓存在请求内存。
      if (request.body instanceof Readable && !request.body.destroyed) request.body.resume()
    }
  }
}

/** 装配本地可信产物服务，HTTP 层不导入 SDK 或执行器内部路径。 */
@Module({})
export class ArtifactsModule {
  /** 服务实例在启动前固定，浏览器不能选择检查端口或存储根。 */
  static register(service: ArtifactsService): DynamicModule {
    return {
      module: ArtifactsModule,
      controllers: [ArtifactsController],
      providers: [{ provide: ArtifactsService, useValue: service }],
    }
  }
}
