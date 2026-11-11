/** @description 本机团队会话和成员维护；控制面不公开口令摘要、会话令牌或宿主路径。 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Module,
  Param,
  Post,
  Query,
  Req,
  Res,
  type DynamicModule,
} from '@nestjs/common'
import type { FastifyReply, FastifyRequest } from 'fastify'
import {
  hasExactKeys,
  isRecord,
  isLocalTeamPermissions,
  type TeamAuditPage,
  type LocalTeamMember,
  type LocalTeamSession,
  type TeamGrantOption,
} from '@release-harbor/contracts'
import { DomainError } from '@release-harbor/domain'
import { LocalTeamRuntime } from './runtime.ts'
import { currentTeamAccount } from './access.ts'
import { TeamAuditQuery } from './audit-query.ts'
import { teamMember } from './store.ts'

@Controller('team')
class LocalTeamController {
  constructor(@Inject(LocalTeamRuntime) private readonly team: LocalTeamRuntime) {}

  /** 返回工作台身份状态；匿名请求不返回目录。 */
  @Get('session')
  session(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): LocalTeamSession {
    reply.header('Cache-Control', 'no-store')
    return this.team.session(request)
  }

  /** 校验本机账号，成功时仅写会话 Cookie。 */
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() input: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ ok: true }> {
    const { username, password } = exact(input, ['username', 'password'])
    await this.team.login(reply, username, password)
    return { ok: true }
  }

  /** 撤销当前会话；不影响其他已登录浏览器。 */
  @Post('logout')
  @HttpCode(200)
  logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): { ok: true } {
    this.team.logout(request, reply)
    return { ok: true }
  }

  /** 只允许管理员读取安全成员列表。 */
  @Get('members')
  members(@Req() request: FastifyRequest): { items: LocalTeamMember[] } {
    return { items: this.team.administrator(request).accounts.map(teamMember) }
  }

  /** 管理员读取完整安全日志，筛选不会触发准备、恢复或官方查询。 */
  @Get('audit')
  async audit(@Req() request: FastifyRequest, @Query() query: unknown): Promise<TeamAuditPage> {
    const { store } = this.team.administrator(request)
    return new TeamAuditQuery(store, this.team.policy).list(query)
  }

  /** 记录详情的身份查询独立复核原目标与当前授权，不接受浏览器指定操作者。 */
  @Get('records/:projectId/:applicationId/:kind/:recordId')
  async record(
    @Param('projectId') p: string,
    @Param('applicationId') a: string,
    @Param('kind') kind: string,
    @Param('recordId') id: string,
    @Query() query: unknown,
  ): Promise<TeamAuditPage> {
    if (!isRecord(query) || Object.keys(query).some((k) => k !== 'page'))
      throw new DomainError('审计筛选字段不正确')
    const account = await currentTeamAccount()
    if (!account || !this.team.store) throw new DomainError('请先登录本机团队工作台', 401)
    return new TeamAuditQuery(this.team.store, this.team.policy).record(
      account,
      p,
      a,
      kind,
      id,
      query,
    )
  }

  /** 创建不带业务授权的成员账号，不接受管理员角色或其他字段。 */
  @Post('members')
  async add(@Req() request: FastifyRequest, @Body() input: unknown): Promise<LocalTeamMember> {
    const { username, password } = exact(input, ['username', 'password'])
    return this.team.administrator(request).store.add(username, password)
  }

  /** 应用候选仅由管理员读取，从可信目录恢复真实归属。 */
  @Get('grant-options')
  async options(@Req() request: FastifyRequest): Promise<{ items: TeamGrantOption[] }> {
    this.team.administrator(request)
    return { items: (await this.team.policy?.catalog()) ?? [] }
  }

  /** 权限保存核对应用归属及兼容的旧绑定版本，再以成员权限版本串行写入安装目录。 */
  @Post('members/:id/permissions')
  @HttpCode(200)
  async permissions(
    @Req() request: FastifyRequest,
    @Param('id') id: string,
    @Body() input: unknown,
  ): Promise<LocalTeamMember> {
    const { store } = this.team.administrator(request)
    if (!isLocalTeamPermissions(input) || !this.team.policy)
      throw new DomainError('成员权限格式不正确')
    await this.team.policy.validatePermissions(input)
    return store.setPermissions(id, input)
  }

  /** 启停或重置仅作用于目标成员；不支持将成员提升为管理员。 */
  @Post('members/:id')
  @HttpCode(200)
  async update(
    @Req() request: FastifyRequest,
    @Param('id') id: string,
    @Body() input: unknown,
  ): Promise<LocalTeamMember> {
    const store = this.team.administrator(request).store
    const action = isRecord(input) ? input.action : undefined
    if (action === 'enable' || action === 'disable') {
      exact(input, ['action'])
      return store.update(id, action)
    }
    if (action === 'reset')
      return store.update(id, action, exact(input, ['action', 'password']).password)
    throw new DomainError('成员操作不受支持')
  }
}

/** 注入与请求边界相同的运行对象，避免会话和账号校验来自不同存储。 */
@Module({})
export class LocalTeamModule {
  /** 工作台始终提供身份探测；仅安装已初始化时发放会话。 */
  static register(team: LocalTeamRuntime): DynamicModule {
    return {
      module: LocalTeamModule,
      controllers: [LocalTeamController],
      providers: [{ provide: LocalTeamRuntime, useValue: team }],
    }
  }
}

function exact(input: unknown, keys: string[]): Record<string, unknown> {
  if (!isRecord(input) || !hasExactKeys(input, keys))
    throw new DomainError('本机团队请求字段不正确')
  return input
}
