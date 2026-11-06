/** @description 批次 HTTP 只接收公开意图和明确确认，来源受限；后台执行不绑定请求连接。 */
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Module,
  Param,
  Post,
  Put,
  Req,
  type DynamicModule,
} from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import { DomainError } from '@release-harbor/domain'
import { isRecord, hasExactKeys, type ReleaseBatch } from '@release-harbor/contracts'
import { ReleaseBatchesService } from './release-batches.service.ts'
import { ReleasePlansService } from './release-plans.service.ts'
@Controller('projects/:projectId/applications/:applicationId/release-batches')
class BatchController {
  constructor(
    @Inject(ReleaseBatchesService) private readonly service: ReleaseBatchesService,
    @Inject(ReleasePlansService) private readonly source: ReleasePlansService,
  ) {}
  private guard(req: FastifyRequest): void {
    this.source.assertSource(req.headers.origin, req.headers['x-release-harbor-plan'])
  }
  /** 列表仅返回当前应用的原始事实。 */
  @Get()
  @Header('Cache-Control', 'no-store')
  async list(
    @Param('projectId') p: string,
    @Param('applicationId') a: string,
  ): Promise<{ items: ReleaseBatch[] }> {
    return { items: await this.service.list('local', p, a) }
  }
  /** 详情不启动查询或重放任务。 */
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  async get(
    @Param('projectId') p: string,
    @Param('applicationId') a: string,
    @Param('id') id: string,
  ): Promise<{ batch: ReleaseBatch }> {
    return { batch: await this.service.get('local', p, a, id) }
  }
  /** 保存公开草稿，拒绝客户端归属和秘密。 */
  @Post()
  @Header('Cache-Control', 'no-store')
  async create(
    @Param('projectId') p: string,
    @Param('applicationId') a: string,
    @Req() req: FastifyRequest,
    @Body() body: unknown,
  ): Promise<{ batch: ReleaseBatch }> {
    this.guard(req)
    return { batch: await this.service.create('local', p, a, body) }
  }
  /** 乐观版本只修改当前草稿。 */
  @Put(':id')
  @Header('Cache-Control', 'no-store')
  async edit(
    @Param('projectId') p: string,
    @Param('applicationId') a: string,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
    @Body() body: unknown,
  ): Promise<{ batch: ReleaseBatch }> {
    this.guard(req)
    return { batch: await this.service.edit('local', p, a, id, body) }
  }
  /** 受理后异步只读准备，刷新返回原进度。 */
  @Post(':id/prepare')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  async prepare(
    @Param('projectId') p: string,
    @Param('applicationId') a: string,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
    @Body() body: unknown,
  ): Promise<{ batch: ReleaseBatch }> {
    this.guard(req)
    return { batch: await this.service.prepare('local', p, a, id, body) }
  }
  /** 摘要、明确同意与来源缺一不可，同意和预约在同文件原子提交。 */
  @Post(':id/revisions/:rid/confirm-and-start')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  async confirm(
    @Param('projectId') p: string,
    @Param('applicationId') a: string,
    @Param('id') id: string,
    @Param('rid') rid: string,
    @Req() req: FastifyRequest,
    @Body() body: unknown,
  ): Promise<{ batch: ReleaseBatch }> {
    this.guard(req)
    return { batch: await this.service.confirm('local', p, a, id, rid, body) }
  }
  /** 停止未开始写入项，不撤回远端。 */
  @Post(':id/runs/:runId/stop')
  @Header('Cache-Control', 'no-store')
  async stop(
    @Param('projectId') p: string,
    @Param('applicationId') a: string,
    @Param('id') id: string,
    @Param('runId') runId: string,
    @Req() req: FastifyRequest,
    @Body() body: unknown,
  ): Promise<{ batch: ReleaseBatch }> {
    this.guard(req)
    if (body !== undefined && (!isRecord(body) || !hasExactKeys(body, [])))
      throw new DomainError('停止不接受额外字段')
    return { batch: await this.service.stop('local', p, a, id, runId) }
  }
}
/** 用例由本机启动装配；API 不导入上传 SDK。 */
@Module({})
export class ReleaseBatchesModule {
  /** 与旧计划复用来源保护和生命周期。 */
  static register(service: ReleaseBatchesService, source: ReleasePlansService): DynamicModule {
    return {
      module: ReleaseBatchesModule,
      controllers: [BatchController],
      providers: [
        { provide: ReleaseBatchesService, useValue: service },
        { provide: ReleasePlansService, useValue: source },
      ],
    }
  }
}
