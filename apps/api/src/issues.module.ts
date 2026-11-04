/** @description 问题档案只读 HTTP 边界，继承本机来源保护；不接受文件路径、不写仓库或执行商店操作。 */
import {
  Controller,
  Get,
  Header,
  Inject,
  Module,
  Param,
  Res,
  type DynamicModule,
} from '@nestjs/common'
import type { FastifyReply } from 'fastify'
import type { IssueCatalog, IssueRecord } from '@release-harbor/contracts'
import { IssuesService } from './issues.service.ts'
@Controller('issues')
class IssuesController {
  constructor(@Inject(IssuesService) private readonly service: IssuesService) {}
  /** 当前安装版本的完整公开目录，筛选由页面在已验证事实内完成。 */
  @Get()
  @Header('Cache-Control', 'no-store')
  list(): Promise<IssueCatalog> {
    return this.service.list()
  }
  /** 深链接仅按已登记编号查询。 */
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  async get(@Param('id') id: string): Promise<{ issue: IssueRecord }> {
    return { issue: await this.service.get(id) }
  }
  /** 以纯文本查看本条证据，不能将文档内容当作 HTML 执行。 */
  @Get(':id/documents/:index')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'none'")
  @Header('Cache-Control', 'no-store')
  async document(
    @Param('id') id: string,
    @Param('index') index: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    const text = await this.service.document(id, index)
    // 仅成功正文使用纯文本；错误仍交公共过滤器返回 JSON，避免类型冲突变成 500。
    reply.type('text/plain; charset=utf-8')
    return text
  }
}
/** 固定资源服务由启动或测试注入，页面不能选择替代文件。 */
@Module({})
export class IssuesModule {
  static register(service: IssuesService): DynamicModule {
    return {
      module: IssuesModule,
      controllers: [IssuesController],
      providers: [{ provide: IssuesService, useValue: service }],
    }
  }
}
