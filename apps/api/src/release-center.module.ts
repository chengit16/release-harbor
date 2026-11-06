/** @description 发布中心本机只读 HTTP 边界；固定可信工作空间，不开放新的写入口。 */
import { Controller, Get, Header, Inject, Module, type DynamicModule } from '@nestjs/common'
import type { ReleaseCenterResponse } from '@release-harbor/contracts'
import { ReleaseCenterService } from './release-center.service.ts'

@Controller('release-center')
class ReleaseCenterController {
  constructor(@Inject(ReleaseCenterService) private readonly service: ReleaseCenterService) {}

  /** 返回本机计划与批次摘要；查询参数不能改变工作空间，也不触发商店操作。 */
  @Get()
  @Header('Cache-Control', 'no-store')
  async list(): Promise<ReleaseCenterResponse> {
    return this.service.list('local')
  }
}

/** 只读服务由启动边界装配，沿用全局 Host／Origin 限制。 */
@Module({})
export class ReleaseCenterModule {
  /** 本机依赖必须完整，不能用空历史掩盖缺少发布服务。 */
  static register(service: ReleaseCenterService): DynamicModule {
    return {
      module: ReleaseCenterModule,
      controllers: [ReleaseCenterController],
      providers: [{ provide: ReleaseCenterService, useValue: service }],
    }
  }
}
