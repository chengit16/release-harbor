/** @description 状态观察本机 API，读历史与显式刷新分开；来源校验不等同于在线身份认证。 */
import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  Header,
  Inject,
  Module,
  type DynamicModule,
} from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import { DomainError } from '@release-harbor/domain'
import { hasExactKeys, isRecord, type ReleaseObservation } from '@release-harbor/contracts'
import { ReleasePlansService } from './release-plans.service.ts'
import { ReleaseObservationService } from './release-observation.service.ts'
@Controller('projects/:projectId/applications/:applicationId/release-plans/:planId/observations')
class ReleaseObservationController {
  constructor(
    @Inject(ReleaseObservationService) private readonly service: ReleaseObservationService,
    @Inject(ReleasePlansService) private readonly source: ReleasePlansService,
  ) {}
  /** GET 只返回已有观察，导航或刷新页面不访问商店。 */
  @Get()
  @Header('Cache-Control', 'no-store')
  async list(
    @Param('projectId') p: string,
    @Param('applicationId') a: string,
    @Param('planId') id: string,
  ): Promise<{ items: ReleaseObservation[] }> {
    return { items: await this.service.list(p, a, id) }
  }
  /** 明确点击后只读查询；客户端不能指定版本、账号、商店域名或 HTTP 方法。 */
  @Post()
  @Header('Cache-Control', 'no-store')
  async query(
    @Param('projectId') p: string,
    @Param('applicationId') a: string,
    @Param('planId') id: string,
    @Req() req: FastifyRequest,
    @Body() body: unknown,
  ): Promise<{ observation: ReleaseObservation }> {
    this.source.assertSource(req.headers.origin, req.headers['x-release-harbor-plan'])
    if (!isRecord(body) || !hasExactKeys(body, []))
      throw new DomainError('状态查询不接受目标覆盖字段')
    return { observation: await this.service.query(p, a, id) }
  }
}
/** 启动边界注入固定执行器与存储，API 不加载 SDK 或凭据。 */
@Module({})
export class ReleaseObservationModule {
  /** 不增加写授权端点，仅开放显式查询与本机历史。 */
  static register(service: ReleaseObservationService, source: ReleasePlansService): DynamicModule {
    return {
      module: ReleaseObservationModule,
      controllers: [ReleaseObservationController],
      providers: [
        { provide: ReleaseObservationService, useValue: service },
        { provide: ReleasePlansService, useValue: source },
      ],
    }
  }
}
