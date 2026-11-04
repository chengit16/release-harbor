/** @description 发布准备 HTTP 边界；固定本机归属及来源，HTTP 不等待只读校验结束。 */
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
  Req,
  type DynamicModule,
} from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import type { ReleasePreparation } from '@release-harbor/contracts'
import { ReleasePreparationsService } from './release-preparations.service.ts'
import { ReleasePlansService } from './release-plans.service.ts'
@Controller('projects/:projectId/applications/:applicationId/release-preparations')
class PreparationController {
  constructor(
    @Inject(ReleasePreparationsService) private readonly service: ReleasePreparationsService,
    @Inject(ReleasePlansService) private readonly plans: ReleasePlansService,
  ) {}
  /** 只查已有准备事实，刷新不会再次访问商店。 */
  @Get()
  @Header('Cache-Control', 'no-store')
  async list(
    @Param('projectId') project: string,
    @Param('applicationId') application: string,
  ): Promise<{ items: ReleasePreparation[] }> {
    return { items: await this.service.list('local', project, application) }
  }
  /** 精确来源加请求标记，仅受理公开意图。 */
  @Post()
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  async start(
    @Param('projectId') project: string,
    @Param('applicationId') application: string,
    @Req() request: FastifyRequest,
    @Body() body: unknown,
  ): Promise<{ preparation: ReleasePreparation }> {
    this.plans.assertSource(request.headers.origin, request.headers['x-release-harbor-plan'])
    return { preparation: await this.service.start('local', project, application, body) }
  }
}
/** 仅在本机主入口显式装配，测试可注入合成只读端口。 */
@Module({})
export class ReleasePreparationsModule {
  /** 准备服务与计划来源保护复用，不向 API 注入 SDK。 */
  static register(service: ReleasePreparationsService, plans: ReleasePlansService): DynamicModule {
    return {
      module: ReleasePreparationsModule,
      controllers: [PreparationController],
      providers: [
        { provide: ReleasePreparationsService, useValue: service },
        { provide: ReleasePlansService, useValue: plans },
      ],
    }
  }
}
