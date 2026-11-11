/** @description 本机维护 HTTP 边界；来源标记与明确确认必需，不暴露任意文件或工具命令。 */
import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Module,
  Param,
  Post,
  Req,
  Res,
  type DynamicModule,
} from '@nestjs/common'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { DomainError } from '@release-harbor/domain'
import { hasExactKeys, isRecord } from '@release-harbor/contracts'
import { LocalProductivityService } from './local-productivity.service.ts'
@Controller('local')
class LocalProductivityController {
  constructor(
    @Inject(LocalProductivityService) private readonly service: LocalProductivityService,
  ) {}
  private source(req: FastifyRequest) {
    this.service.assertSource(req.headers.origin, req.headers['x-release-harbor-local'])
  }
  /** 只读占用与引用目录。 */
  @Get('storage') @Header('Cache-Control', 'no-store') storage() {
    return this.service.storage()
  }
  /** 清理仅回收字节，保留元数据与发布保护。 */
  @Post('artifacts/cleanup') async cleanup(@Req() req: FastifyRequest, @Body() body: unknown) {
    this.source(req)
    await this.service.cleanup(body)
    return { ok: true }
  }
  /** 明确确认后删除失败／已清理记录，可信归属和状态由服务端重新核对。 */
  @Post('artifacts/delete') async deleteArtifacts(
    @Req() req: FastifyRequest,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    this.source(req)
    await this.service.deleteArtifacts(body)
    return { ok: true }
  }
  /** 受控原文件下载，禁止缓存与内容嗅探。 */
  @Get('artifacts/:projectId/:applicationId/:id/download') async download(
    @Param('projectId') p: string,
    @Param('applicationId') a: string,
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ) {
    const result = await this.service.download(p, a, id)
    reply
      .header('Cache-Control', 'no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Type', 'application/octet-stream')
      .header('Content-Length', result.size)
      .header(
        'Content-Disposition',
        `attachment; filename="artifact"; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
      )
    return reply.send(result.stream)
  }
  /** 删除指定备份，不允许任意路径。 */
  @Post('backups/delete') async backups(@Req() req: FastifyRequest, @Body() body: unknown) {
    this.source(req)
    await this.service.removeBackups(body)
    return { ok: true }
  }
  /** 只读本机运行状态，不进行商店鉴权。 */
  @Get('diagnostics') @Header('Cache-Control', 'no-store') async diagnostics() {
    return { items: await this.service.diagnostics() }
  }
  /** 只读配置来源，不自动准备。 */
  @Get('reuse/:projectId/:applicationId') @Header('Cache-Control', 'no-store') async reuse(
    @Param('projectId') p: string,
    @Param('applicationId') a: string,
  ) {
    return { items: await this.service.reuse(p, a) }
  }
  /** 保存配置模板，无执行授权。 */
  @Post('reuse/:projectId/:applicationId') async save(
    @Param('projectId') p: string,
    @Param('applicationId') a: string,
    @Req() req: FastifyRequest,
    @Body() body: unknown,
  ) {
    this.source(req)
    await this.service.savePreset(p, a, body)
    return { ok: true }
  }
  /** 只删除当前应用的模板，不能删除历史。 */
  @Post('reuse/:projectId/:applicationId/delete') async remove(
    @Param('projectId') p: string,
    @Param('applicationId') a: string,
    @Req() req: FastifyRequest,
    @Body() body: unknown,
  ) {
    this.source(req)
    if (!isRecord(body) || !hasExactKeys(body, ['id']) || typeof body.id !== 'string')
      throw new DomainError('模板格式无效', 400)
    await this.service.reuse(p, a)
    await this.service.presets.remove(p, a, body.id)
    return { ok: true }
  }
}
/** 仅由宿主装配共享维护门禁，不新建独立写槽。 */
@Module({})
export class LocalProductivityModule {
  /** 测试注入隔离存储，生产不开放模拟开关。 */
  static register(service: LocalProductivityService): DynamicModule {
    return {
      module: LocalProductivityModule,
      controllers: [LocalProductivityController],
      providers: [{ provide: LocalProductivityService, useValue: service }],
    }
  }
}
