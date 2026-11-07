/** @description 本机增强 HTTP 边界；写操作要求来源及标记，备份接口不接受服务器路径。 */
import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  Req,
  Header,
  Inject,
  Module,
  type DynamicModule,
} from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import { DomainError } from '@release-harbor/domain'
import { isRecord, hasExactKeys } from '@release-harbor/contracts'
import { LocalEfficiencyService } from './local-efficiency.service.ts'

@Controller('local')
class LocalEfficiencyController {
  constructor(@Inject(LocalEfficiencyService) private readonly service: LocalEfficiencyService) {}
  private source(req: FastifyRequest): void {
    this.service.assertSource(req.headers.origin, req.headers['x-release-harbor-local'])
  }
  /** 只读设置、通知与备份摘要。 */
  @Get() @Header('Cache-Control', 'no-store') view() {
    return this.service.view()
  }
  /** 设置不会自动授予浏览器权限或发布许可。 */
  @Post('settings') async settings(@Req() req: FastifyRequest, @Body() body: unknown) {
    this.source(req)
    await this.service.settings(body)
    return { ok: true }
  }
  /** 创建业务备份，禁止夹带正文。 */
  @Post('backups') async backup(@Req() req: FastifyRequest, @Body() body: unknown) {
    this.source(req)
    if (!isRecord(body) || Object.keys(body).length)
      throw new DomainError('备份不接受附加字段', 400)
    return { backup: await this.service.backup() }
  }
  /** 下载指定备份容器，不能读取任意文件。 */
  @Get('backups/:id') @Header('Cache-Control', 'no-store') async download(@Param('id') id: string) {
    return { backup: await this.service.backups.download(id) }
  }
  /** 导入仅有界文本；隔离校验后返回预览，不自动覆盖。 */
  @Post('restore-preview') async preview(@Req() req: FastifyRequest, @Body() body: unknown) {
    this.source(req)
    return { preview: await this.service.preview(body) }
  }
  /** 恢复需要精确预览摘要与明确确认。 */
  @Post('restore') async restore(@Req() req: FastifyRequest, @Body() body: unknown) {
    this.source(req)
    await this.service.restore(body)
    return { ok: true, restarting: true }
  }
  /** 用户显式开启只读跟踪。 */
  @Post('follows') async follow(@Req() req: FastifyRequest, @Body() body: unknown) {
    this.source(req)
    return { follow: await this.service.tracking.start(body) }
  }
  /** 暂停、继续或结束不会提交商店动作。 */
  @Post('follows/:id') async control(
    @Param('id') id: string,
    @Req() req: FastifyRequest,
    @Body() body: unknown,
  ) {
    this.source(req)
    if (!isRecord(body) || !hasExactKeys(body, ['action']))
      throw new DomainError('跟踪操作格式无效', 400)
    await this.service.tracking.control(id, body.action)
    return { ok: true }
  }
  /** 恢复前发布事实只读展示，不从旧业务快照丢弃。 */
  @Get('protections') @Header('Cache-Control', 'no-store') protections() {
    return this.service.protections().then((items) => ({ items }))
  }
  /** 核对只附加人工来源，不触发商店写入。 */
  @Post('protections/reconcile') async protection(
    @Req() req: FastifyRequest,
    @Body() body: unknown,
  ) {
    this.source(req)
    await this.service.reconcileProtection(body)
    return { ok: true }
  }
  /** 已读只改变通知状态。 */
  @Post('notices/:id/read') async read(
    @Param('id') id: string,
    @Req() req: FastifyRequest,
    @Body() body: unknown,
  ) {
    this.source(req)
    if (!isRecord(body) || Object.keys(body).length) throw new DomainError('不接受附加字段', 400)
    await this.service.readNotice(id)
    return { ok: true }
  }
}
/** 运行依赖由本机启动边界注入，测试可使用隔离目录。 */
@Module({})
export class LocalEfficiencyModule {
  /** 不在模块内创建目录、时钟或远端执行器。 */
  static register(service: LocalEfficiencyService): DynamicModule {
    return {
      module: LocalEfficiencyModule,
      controllers: [LocalEfficiencyController],
      providers: [{ provide: LocalEfficiencyService, useValue: service }],
    }
  }
}
