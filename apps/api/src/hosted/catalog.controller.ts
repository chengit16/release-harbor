/** @description 在线目录 HTTP 接口；路由 ID 仅定位，每次访问先获取可信空间事务。 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import type { Application, ChannelBinding, HostedMember, Project } from '@release-harbor/contracts'
import { requestSession } from './auth.controller.ts'
import { HostedCatalog } from './catalog.ts'
import { exactFields, hostedRole } from './identity.ts'
import { HostedSessions, type HostedScope } from './session-store.ts'

type ScopeRequest = FastifyRequest<{ Params: { workspaceId: string } }>

/** 通过会话和成员关系访问在线目录，不挂载任何本机或发布端点。 */
@Controller('workspaces/:workspaceId')
export class HostedCatalogController {
  constructor(
    @Inject(HostedSessions) private readonly sessions: HostedSessions,
    @Inject(HostedCatalog) private readonly catalog: HostedCatalog,
  ) {}

  /** 管理员读取空间成员的显示信息。 */
  @Get('members')
  async members(@Req() request: ScopeRequest): Promise<{ items: HostedMember[] }> {
    return { items: await this.access(request, true, (scope) => this.catalog.members(scope)) }
  }

  /** 管理员预登记已知身份，浏览器不能指定发行者。 */
  @Post('members')
  addMember(@Req() request: ScopeRequest, @Body() input: unknown): Promise<HostedMember> {
    return this.access(request, true, (scope) => this.catalog.addMember(scope, input))
  }

  /** 按当前权限修改空间内成员角色。 */
  @Patch('members/:memberId')
  async setMember(
    @Req() request: ScopeRequest,
    @Param('memberId') memberId: string,
    @Body() input: unknown,
  ): Promise<{ ok: true }> {
    await this.access(request, true, (scope) =>
      this.catalog.setMember(scope, memberId, hostedRole(exactFields(input, ['role']).role)),
    )
    return { ok: true }
  }

  /** 撤销指定空间的成员关系，不修改其他空间的授权。 */
  @Delete('members/:memberId')
  @HttpCode(200)
  async removeMember(
    @Req() request: ScopeRequest,
    @Param('memberId') memberId: string,
  ): Promise<{ ok: true }> {
    await this.access(request, true, (scope) => this.catalog.setMember(scope, memberId, undefined))
    return { ok: true }
  }

  /** 列出当前空间的项目。 */
  @Get('projects')
  async projects(@Req() request: ScopeRequest): Promise<{ items: Project[] }> {
    return { items: await this.access(request, false, (scope) => this.catalog.projects(scope)) }
  }

  /** 按空间读取项目详情。 */
  @Get('projects/:projectId')
  project(@Req() request: ScopeRequest, @Param('projectId') projectId: string): Promise<Project> {
    return this.access(request, false, (scope) => this.catalog.project(scope, projectId))
  }

  /** 管理员在可信空间创建项目。 */
  @Post('projects')
  addProject(@Req() request: ScopeRequest, @Body() input: unknown): Promise<Project> {
    return this.access(request, true, (scope) => this.catalog.addProject(scope, input))
  }

  /** 列出归属指定项目的应用。 */
  @Get('projects/:projectId/applications')
  async applications(
    @Req() request: ScopeRequest,
    @Param('projectId') projectId: string,
  ): Promise<{ items: Application[] }> {
    return {
      items: await this.access(request, false, (scope) =>
        this.catalog.applications(scope, projectId),
      ),
    }
  }

  /** 按空间和父项目读取应用详情。 */
  @Get('projects/:projectId/applications/:appId')
  application(
    @Req() request: ScopeRequest,
    @Param('projectId') projectId: string,
    @Param('appId') appId: string,
  ): Promise<Application> {
    return this.access(request, false, (scope) => this.catalog.application(scope, projectId, appId))
  }

  /** 管理员登记 Android 包身份。 */
  @Post('projects/:projectId/applications')
  addApplication(
    @Req() request: ScopeRequest,
    @Param('projectId') projectId: string,
    @Body() input: unknown,
  ): Promise<Application> {
    return this.access(request, true, (scope) =>
      this.catalog.addApplication(scope, projectId, input),
    )
  }

  /** 读取已保存绑定，不向商店查询。 */
  @Get('projects/:projectId/applications/:appId/bindings')
  async bindings(
    @Req() request: ScopeRequest,
    @Param('projectId') projectId: string,
    @Param('appId') appId: string,
  ): Promise<{ items: ChannelBinding[] }> {
    return {
      items: await this.access(request, false, (scope) =>
        this.catalog.bindings(scope, projectId, appId),
      ),
    }
  }

  /** 保存华为配置和凭据引用，不解析凭据。 */
  @Post('projects/:projectId/applications/:appId/bindings')
  addBinding(
    @Req() request: ScopeRequest,
    @Param('projectId') projectId: string,
    @Param('appId') appId: string,
    @Body() input: unknown,
  ): Promise<ChannelBinding> {
    return this.access(request, true, (scope) =>
      this.catalog.addBinding(scope, projectId, appId, input),
    )
  }

  /** 比较版本后修改当前应用的配置。 */
  @Patch('projects/:projectId/applications/:appId/bindings/:bindingId')
  updateBinding(
    @Req() request: ScopeRequest,
    @Param('projectId') projectId: string,
    @Param('appId') appId: string,
    @Param('bindingId') bindingId: string,
    @Body() input: unknown,
  ): Promise<ChannelBinding> {
    return this.access(request, true, (scope) =>
      this.catalog.updateBinding(scope, projectId, appId, bindingId, input),
    )
  }

  private access<T>(
    request: ScopeRequest,
    admin: boolean,
    run: (scope: HostedScope) => Promise<T>,
  ) {
    return this.sessions.scope(requestSession(request), request.params.workspaceId, admin, run)
  }
}
