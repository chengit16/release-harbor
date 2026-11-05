/** @description Apple 审核与发布的本机控制面端点；安全来源及父级归属检查后调用用例，不解析凭据。 */
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Req,
  Header,
  Inject,
  Module,
  type DynamicModule,
} from '@nestjs/common'
import type { AppleReviewRecord, AppleReviewCatalog } from '@release-harbor/contracts'
import type { FastifyRequest } from 'fastify'
import { AppleReviewService } from './apple-review.service.ts'
import { ReleasePlansService } from './release-plans.service.ts'
@Controller('projects/:projectId/applications/:applicationId/apple-review')
class AppleReviewController {
  constructor(
    @Inject(AppleReviewService) private readonly service: AppleReviewService,
    @Inject(ReleasePlansService) private readonly source: ReleasePlansService,
  ) {}
  /** 读取已保存的历史，不因页面刷新执行商店请求。 */
  @Get()
  @Header('Cache-Control', 'no-store')
  async list(
    @Param('projectId') p: string,
    @Param('applicationId') a: string,
  ): Promise<{ items: AppleReviewRecord[] }> {
    return { items: await this.service.list(p, a) }
  }
  /** 显式刷新远端目录，来源头仅对当前本机控制台开放。 */
  @Post('catalog')
  @Header('Cache-Control', 'no-store')
  async catalog(
    @Param('projectId') p: string,
    @Param('applicationId') a: string,
    @Req() req: FastifyRequest,
    @Body() body: unknown,
  ): Promise<{ catalog: AppleReviewCatalog }> {
    this.source.assertSource(req.headers.origin, req.headers['x-release-harbor-plan'])
    return { catalog: await this.service.catalog(p, a, body) }
  }
  /** 准备只读快照，不上传、不送审、不发布。 */
  @Post('prepare')
  @Header('Cache-Control', 'no-store')
  async prepare(
    @Param('projectId') p: string,
    @Param('applicationId') a: string,
    @Req() req: FastifyRequest,
    @Body() body: unknown,
  ): Promise<{ record: AppleReviewRecord }> {
    this.source.assertSource(req.headers.origin, req.headers['x-release-harbor-plan'])
    return { record: await this.service.prepare(p, a, body) }
  }
  /** 确认消费后立即返回，长时间商店写入在独立 worker。 */
  @Post(':id/execute')
  @Header('Cache-Control', 'no-store')
  async execute(
    @Param('projectId') p: string,
    @Param('applicationId') a: string,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
    @Body() body: unknown,
  ): Promise<{ record: AppleReviewRecord }> {
    this.source.assertSource(req.headers.origin, req.headers['x-release-harbor-plan'])
    return { record: await this.service.execute(p, a, id, body) }
  }
  /** 仅附加用户核对声明，不修改原始回执。 */
  @Post(':id/reconcile')
  @Header('Cache-Control', 'no-store')
  async reconcile(
    @Param('projectId') p: string,
    @Param('applicationId') a: string,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
    @Body() body: unknown,
  ): Promise<{ record: AppleReviewRecord }> {
    this.source.assertSource(req.headers.origin, req.headers['x-release-harbor-plan'])
    return { record: await this.service.reconcile(p, a, id, body) }
  }
}
/** 仅装配控制服务，不加载 SDK 或上传适配。 */
@Module({})
export class AppleReviewModule {
  static register(service: AppleReviewService, source: ReleasePlansService): DynamicModule {
    return {
      module: AppleReviewModule,
      controllers: [AppleReviewController],
      providers: [
        { provide: AppleReviewService, useValue: service },
        { provide: ReleasePlansService, useValue: source },
      ],
    }
  }
}
