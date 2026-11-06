/** @description 独立商店状态查询 API；GET 只读绑定目录，POST 仅由明确点击触发官方只读查询。 */
import {
  Inject,
  Req,
  Body,
  Controller,
  Get,
  Header,
  Module,
  Param,
  Post,
  type DynamicModule,
} from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import { DomainError } from '@release-harbor/domain'
import {
  hasExactKeys,
  isRecord,
  type StoreStatusResponse,
  type StoreStatusSnapshot,
} from '@release-harbor/contracts'
import { StoreStatusService } from './store-status.service.ts'

@Controller('store-status')
class StoreStatusController {
  constructor(@Inject(StoreStatusService) private readonly service: StoreStatusService) {}

  /** 刷新页面只读绑定与缓存，不访问商店。 */
  @Get()
  @Header('Cache-Control', 'no-store')
  list(): Promise<StoreStatusResponse> {
    return this.service.list()
  }

  /** 查询目标从 URL 归属恢复，拒绝客户端传入版本、账号、渠道和地址。 */
  @Post(':projectId/:applicationId/:bindingId/query')
  @Header('Cache-Control', 'no-store')
  async query(
    @Param('projectId') projectId: string,
    @Param('applicationId') applicationId: string,
    @Param('bindingId') bindingId: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ): Promise<{ snapshot: StoreStatusSnapshot }> {
    this.service.assertSource(req.headers.origin, req.headers['x-release-harbor-query'])
    if (!isRecord(body) || !hasExactKeys(body, []))
      throw new DomainError('状态查询不接受目标覆盖字段')
    return { snapshot: await this.service.query(projectId, applicationId, bindingId) }
  }
}

/** 装配独立查询服务，不导入发布计划模块。 */
@Module({})
export class StoreStatusModule {
  /** 注入本机目录、应用绑定和可信查询 worker，不创建发布授权路径。 */
  static register(service: StoreStatusService): DynamicModule {
    return {
      module: StoreStatusModule,
      controllers: [StoreStatusController],
      providers: [{ provide: StoreStatusService, useValue: service }],
    }
  }
}
