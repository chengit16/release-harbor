/** @description 本机执行 HTTP 边界，输入只接受摘要与明确同意；请求不等待远端上传完成。 */
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
import type { ReleaseAttempt } from '@release-harbor/contracts'
import type { FastifyRequest } from 'fastify'
import { ReleaseExecutionService } from './release-execution.service.ts'
import { ReleasePlansService } from './release-plans.service.ts'
@Controller('projects/:projectId/applications/:applicationId')
class ExecutionController {
  constructor(
    @Inject(ReleaseExecutionService) private readonly execution: ReleaseExecutionService,
    @Inject(ReleasePlansService) private readonly plans: ReleasePlansService,
  ) {}
  /** 仅读取安全事实，刷新不派发任务。 */
  @Get('release-attempts')
  @Header('Cache-Control', 'no-store')
  async list(
    @Param('projectId') project: string,
    @Param('applicationId') application: string,
  ): Promise<{ items: ReleaseAttempt[] }> {
    return { items: await this.execution.list('local', project, application) }
  }
  /** 精确来源与明确同意缺一不可，重复执行返回原尝试。 */
  @Post('release-plans/:id/execute')
  @Header('Cache-Control', 'no-store')
  async start(
    @Param('projectId') project: string,
    @Param('applicationId') application: string,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
    @Body() body: unknown,
  ): Promise<{ attempt: ReleaseAttempt }> {
    this.plans.assertSource(req.headers.origin, req.headers['x-release-harbor-plan'])
    return { attempt: await this.execution.start('local', project, application, id, body) }
  }
}
/** 生命周期由 Nest 管理，关闭时停止本地等待，保留安全回执。 */
@Module({})
export class ReleaseExecutionModule {
  /** 显式注入本地控制服务，普通 API 不接触 SDK。 */
  static register(execution: ReleaseExecutionService, plans: ReleasePlansService): DynamicModule {
    return {
      module: ReleaseExecutionModule,
      controllers: [ExecutionController],
      providers: [
        { provide: ReleaseExecutionService, useValue: execution },
        { provide: ReleasePlansService, useValue: plans },
      ],
    }
  }
}
