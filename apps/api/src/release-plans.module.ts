/** @description 发布计划的本机 HTTP 边界，固定可信归属；写入要求精确来源与专用请求头。 */
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
  type DynamicModule,
} from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import type { ReleasePlan, ReleasePlanView } from '@release-harbor/contracts'
import { ReleasePlansService } from './release-plans.service.ts'

@Controller('projects/:projectId/applications/:applicationId/release-plans')
class ReleasePlansController {
  constructor(@Inject(ReleasePlansService) private readonly service: ReleasePlansService) {}
  /** 返回历史快照及当前失效原因，查询不会确认或派发。 */
  @Get()
  @Header('Cache-Control', 'no-store')
  async list(
    @Param('projectId') projectId: string,
    @Param('applicationId') applicationId: string,
  ): Promise<{ items: ReleasePlanView[] }> {
    return { items: await this.service.list('local', projectId, applicationId) }
  }
  /** 以当前通过预检冻结不可变快照，正文不接受服务端事实。 */
  @Post()
  @Header('Cache-Control', 'no-store')
  async freeze(
    @Param('projectId') projectId: string,
    @Param('applicationId') applicationId: string,
    @Req() request: FastifyRequest,
    @Body() body: unknown,
  ): Promise<{ plan: ReleasePlan }> {
    this.source(request)
    return { plan: await this.service.freeze('local', projectId, applicationId, body) }
  }
  /** 明确同意指定摘要，仅生成限定本地确认。 */
  @Post(':id/confirm')
  @Header('Cache-Control', 'no-store')
  async confirm(
    @Param('projectId') projectId: string,
    @Param('applicationId') applicationId: string,
    @Param('id') id: string,
    @Req() request: FastifyRequest,
    @Body() body: unknown,
  ): Promise<{ plan: ReleasePlan }> {
    this.source(request)
    return { plan: await this.service.confirm('local', projectId, applicationId, id, body) }
  }
  /** 取消在队列中撤销授权，不会删除历史或尝试远端撤回。 */
  @Post(':id/cancel')
  @Header('Cache-Control', 'no-store')
  async cancel(
    @Param('projectId') projectId: string,
    @Param('applicationId') applicationId: string,
    @Param('id') id: string,
    @Req() request: FastifyRequest,
    @Body() body: unknown,
  ): Promise<{ plan: ReleasePlan }> {
    this.source(request)
    return { plan: await this.service.cancel('local', projectId, applicationId, id, body) }
  }
  private source(request: FastifyRequest): void {
    this.service.assertSource(request.headers.origin, request.headers['x-release-harbor-plan'])
  }
}
/** 单进程本地服务装配，无任务领取或执行入口。 */
@Module({})
export class ReleasePlansModule {
  /** 计划存储及依赖由启动边界注入。 */
  static register(service: ReleasePlansService): DynamicModule {
    return {
      module: ReleasePlansModule,
      controllers: [ReleasePlansController],
      providers: [{ provide: ReleasePlansService, useValue: service }],
    }
  }
}
