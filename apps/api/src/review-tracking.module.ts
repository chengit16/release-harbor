/** @description 审核状态独立菜单的本机 GET 入口；只返回摘要，不开放新的执行或商店查询路径。 */
import { Controller, Get, Header, Inject, Module, type DynamicModule } from '@nestjs/common'
import type { ReviewTrackingResponse } from '@release-harbor/contracts'
import { ReviewTrackingService } from './review-tracking.service.ts'
@Controller('review-tracking')
class ReviewTrackingController {
  constructor(@Inject(ReviewTrackingService) private readonly service: ReviewTrackingService) {}
  /** 查询参数不改变可信空间，页面导航不会请求商店。 */
  @Get()
  @Header('Cache-Control', 'no-store')
  list(): Promise<ReviewTrackingResponse> {
    return this.service.list()
  }
}
/** 已有依赖完整时由启动边界装配，沿用本机 Host／Origin 限制。 */
@Module({})
export class ReviewTrackingModule {
  /** 只装配只读汇总，不创建第二套发布执行服务。 */
  static register(service: ReviewTrackingService): DynamicModule {
    return {
      module: ReviewTrackingModule,
      controllers: [ReviewTrackingController],
      providers: [{ provide: ReviewTrackingService, useValue: service }],
    }
  }
}
