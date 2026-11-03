/** @description 应用与绑定 HTTP 边界，可信工作空间由模块装配注入，路由参数只用于资源定位。 */
import { Body, Controller, Get, Inject, Module, Param, Post, Put } from '@nestjs/common'
import type { DynamicModule } from '@nestjs/common'
import {
  ApplicationCatalog,
  type ApplicationStore,
  type ProjectStore,
} from '@release-harbor/domain'
import type { Application, ChannelBinding } from '@release-harbor/contracts'

const CATALOG = Symbol('APPLICATION_CATALOG')
const WORKSPACE = Symbol('APPLICATION_WORKSPACE')

@Controller('projects/:projectId/applications')
class ApplicationsController {
  constructor(
    @Inject(CATALOG) private readonly catalog: ApplicationCatalog,
    @Inject(WORKSPACE) private readonly workspaceId: string,
  ) {}

  /** 核对项目归属后返回应用，不提供跨项目全局查询。 */
  @Get()
  async list(@Param('projectId') projectId: string): Promise<{ items: Application[] }> {
    return { items: await this.catalog.list(this.workspaceId, projectId) }
  }

  /** 只接收公开应用输入，workspaceId 由服务端决定。 */
  @Post()
  async create(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ): Promise<{ application: Application }> {
    return { application: await this.catalog.create(this.workspaceId, projectId, body) }
  }

  /** 应用 ID 必须同时属于当前项目和工作空间。 */
  @Get(':applicationId')
  async get(
    @Param('projectId') projectId: string,
    @Param('applicationId') applicationId: string,
  ): Promise<{ application: Application }> {
    return { application: await this.catalog.get(this.workspaceId, projectId, applicationId) }
  }

  /** 返回公开配置，不解析凭据、不查询商店状态。 */
  @Get(':applicationId/bindings')
  async bindings(
    @Param('projectId') projectId: string,
    @Param('applicationId') applicationId: string,
  ): Promise<{ items: ChannelBinding[] }> {
    return { items: await this.catalog.bindings(this.workspaceId, projectId, applicationId) }
  }

  /** 保存首批渠道引用，不能据此启用发布。 */
  @Post(':applicationId/bindings')
  async bind(
    @Param('projectId') projectId: string,
    @Param('applicationId') applicationId: string,
    @Body() body: unknown,
  ): Promise<{ binding: ChannelBinding }> {
    return { binding: await this.catalog.bind(this.workspaceId, projectId, applicationId, body) }
  }

  /** 版本比较由持久化写边界处理，冲突不静默覆盖。 */
  @Put(':applicationId/bindings/:bindingId')
  async update(
    @Param('projectId') projectId: string,
    @Param('applicationId') applicationId: string,
    @Param('bindingId') bindingId: string,
    @Body() body: unknown,
  ): Promise<{ binding: ChannelBinding }> {
    return {
      binding: await this.catalog.updateBinding(
        this.workspaceId,
        projectId,
        applicationId,
        bindingId,
        body,
      ),
    }
  }
}

/** 将存储端口与可信本地上下文装配到控制面，不导入供应商 SDK。 */
@Module({})
export class ApplicationsModule {
  /** 调用方负责提供同一进程共享的存储实例。 */
  static register(
    projects: ProjectStore,
    applications: ApplicationStore,
    workspaceId: string,
  ): DynamicModule {
    return {
      module: ApplicationsModule,
      controllers: [ApplicationsController],
      providers: [
        { provide: CATALOG, useValue: new ApplicationCatalog(projects, applications) },
        { provide: WORKSPACE, useValue: workspaceId },
      ],
    }
  }
}
