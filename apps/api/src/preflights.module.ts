/** @description 只读预检 HTTP 边界，秘密材料及本机路径不作为公开输入。 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Module,
  Param,
  Post,
  type DynamicModule,
} from '@nestjs/common'
import type { PreflightRecord, PreflightView, ProfileCatalog } from '@release-harbor/contracts'
import { PreflightsService } from './preflights.service.ts'

@Controller('profiles')
class ProfilesController {
  constructor(@Inject(PreflightsService) private readonly service: PreflightsService) {}
  /** 当前本机的安全目录元数据，查询不触发商店鉴权。 */
  @Get()
  async list(): Promise<{ catalog: ProfileCatalog }> {
    return { catalog: await this.service.profiles() }
  }
}

@Controller('projects/:projectId/applications/:applicationId/preflights')
class PreflightsController {
  constructor(@Inject(PreflightsService) private readonly service: PreflightsService) {}
  /** 父级归属由服务层核对；历史记录附带当前失效原因。 */
  @Get()
  async list(
    @Param('projectId') projectId: string,
    @Param('applicationId') applicationId: string,
  ): Promise<{ items: PreflightView[] }> {
    return { items: await this.service.list('local', projectId, applicationId) }
  }
  /** 输入只允许公开引用和预期版本，202 表示登记，不能视为通过。 */
  @Post()
  @HttpCode(202)
  async start(
    @Param('projectId') projectId: string,
    @Param('applicationId') applicationId: string,
    @Body() input: unknown,
  ): Promise<{ preflight: PreflightRecord }> {
    return { preflight: await this.service.start('local', projectId, applicationId, input) }
  }
}

/** 固定使用本地可信归属，未来在线租户须从认证上下文取得。 */
@Module({})
export class PreflightsModule {
  /** 生命周期交给 Nest 管理，启动恢复失败时不开放接口。 */
  static register(service: PreflightsService): DynamicModule {
    return {
      module: PreflightsModule,
      controllers: [ProfilesController, PreflightsController],
      providers: [{ provide: PreflightsService, useValue: service }],
    }
  }
}
