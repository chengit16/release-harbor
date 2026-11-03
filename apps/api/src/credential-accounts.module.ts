/** @description 安全账号目录与本机会话控制端点，短期配置能力不缓存且不记录材料。 */
import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Inject,
  Module,
  Param,
  Post,
  type DynamicModule,
} from '@nestjs/common'
import { CredentialAccountsService } from './credential-accounts.service.ts'
import type { CredentialAccounts, CredentialOperation } from '@release-harbor/contracts'
import type { CredentialSetupSession } from '@release-harbor/runner-local'

@Controller()
class CredentialAccountsController {
  constructor(
    @Inject(CredentialAccountsService) private readonly service: CredentialAccountsService,
  ) {}

  /** 目录仅返回安全元数据，保持 local 可信归属。 */
  @Get('credential-accounts')
  @Header('Cache-Control', 'no-store')
  catalog(): Promise<{ catalog: CredentialAccounts }> {
    return this.service.catalog().then((catalog) => ({ catalog }))
  }

  /** 只创建短期能力，正文不能携带任何商店材料。 */
  @Post('local-credential-sessions')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  async session(
    @Body() input: unknown,
    @Headers('origin') origin: unknown,
    @Headers('x-release-harbor-setup') marker: unknown,
  ): Promise<{ session: CredentialSetupSession }> {
    return { session: await this.service.session(input, origin, marker) }
  }

  /** 保存超时／刷新后核对原操作，不重新提交秘密。 */
  @Get('credential-operations/:operationId')
  @Header('Cache-Control', 'no-store')
  async operation(
    @Param('operationId') operationId: string,
  ): Promise<{ operation: CredentialOperation }> {
    return { operation: await this.service.operation(operationId) }
  }
}

/** 固定注入控制端口，HTTP 层不加载商店 SDK。 */
@Module({})
export class CredentialAccountsModule {
  /** Nest 管理独立配置进程生命周期，启动恢复失败时不开放写入口。 */
  static register(service: CredentialAccountsService): DynamicModule {
    return {
      module: CredentialAccountsModule,
      controllers: [CredentialAccountsController],
      providers: [{ provide: CredentialAccountsService, useValue: service }],
    }
  }
}
