/** @description 在线安装包控制面 API；所有能力签发和回收均为显式、受角色约束的请求。 */
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import type {
  HostedArtifact,
  HostedArtifactLink,
  HostedArtifactList,
} from '@release-harbor/contracts'
import { requestSession } from '../auth.controller.ts'
import { HostedCatalog } from '../catalog.ts'
import { exactFields } from '../identity.ts'
import { HostedSessions, type HostedAccess } from '../session-store.ts'
import type { HostedArtifactScope } from './repository.ts'
import { HostedArtifacts } from './service.ts'

type ArtifactRequest = FastifyRequest<{
  Params: { workspaceId: string; projectId: string; appId: string }
}>

/** 只接受定位与业务输入，不接收对象键、上传凭据或任意 URL。 */
@Controller('workspaces/:workspaceId/projects/:projectId/applications/:appId/artifacts')
export class HostedArtifactsController {
  constructor(
    @Inject(HostedSessions) private readonly sessions: HostedSessions,
    @Inject(HostedCatalog) private readonly catalog: HostedCatalog,
    @Inject(HostedArtifacts) private readonly artifacts: HostedArtifacts,
  ) {}

  /** 查询应用安装包和当前空间配额，GET 不访问对象存储。 */
  @Get()
  list(@Req() request: ArtifactRequest): Promise<HostedArtifactList> {
    return this.access(request, 'read', (scope) => this.artifacts.list(scope))
  }

  /** 显式接收 APK，控制面不接收包字节。 */
  @Post()
  begin(@Req() request: ArtifactRequest, @Body() body: unknown): Promise<HostedArtifact> {
    return this.access(request, 'operate', (scope) => this.artifacts.begin(scope, body))
  }

  /** 重新验证文件后告知哪些分片已被对象存储接收。 */
  @Post(':id/resume')
  @HttpCode(200)
  resume(
    @Req() request: ArtifactRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ completedParts: number[] }> {
    return this.access(request, 'operate', (scope) => this.artifacts.resume(scope, id, body))
  }

  /** 只为这个记录的一个分片签发 PUT 能力。 */
  @Post(':id/part')
  @HttpCode(200)
  part(
    @Req() request: ArtifactRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<HostedArtifactLink> {
    return this.access(request, 'operate', (scope) => this.artifacts.part(scope, id, body))
  }

  /** 核对完整对象并冻结版本；不能指定客户端 ETag 或版本。 */
  @Post(':id/complete')
  @HttpCode(200)
  complete(
    @Req() request: ArtifactRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<HostedArtifact> {
    return this.access(request, 'operate', (scope) => {
      exactFields(body, [])
      return this.artifacts.complete(scope, id)
    })
  }

  /** 取消本次 multipart 或保留存储已完成的事实。 */
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @Req() request: ArtifactRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<HostedArtifact> {
    return this.access(request, 'operate', (scope) => {
      exactFields(body, [])
      return this.artifacts.cancel(scope, id)
    })
  }

  /** 重新核对授权后签发精确版本的短期下载。 */
  @Post(':id/download')
  @HttpCode(200)
  download(
    @Req() request: ArtifactRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<HostedArtifactLink> {
    return this.access(request, 'operate', (scope) => {
      exactFields(body, [])
      return this.artifacts.download(scope, id)
    })
  }

  /** 管理员只清理已冻结且无保护的原文件。 */
  @Post(':id/remove')
  @HttpCode(200)
  remove(
    @Req() request: ArtifactRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<HostedArtifact> {
    return this.access(request, 'admin', (scope) => {
      exactFields(body, [])
      return this.artifacts.remove(scope, id)
    })
  }

  private access<T>(
    request: ArtifactRequest,
    access: HostedAccess,
    run: (scope: HostedArtifactScope) => Promise<T>,
  ): Promise<T> {
    const { workspaceId, projectId, appId } = request.params
    return this.sessions.scope(requestSession(request), workspaceId, access, async (scope) => {
      const app = await this.catalog.application(scope, projectId, appId)
      return run({ ...scope, projectId: app.projectId, applicationId: app.id })
    })
  }
}
