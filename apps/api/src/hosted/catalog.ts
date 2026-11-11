/** @description 在线目录事务内的成员、项目、应用和华为绑定维护；所有查询限定完整归属。 */
import { randomUUID } from 'node:crypto'
import type {
  Application,
  ChannelBinding,
  HostedMember,
  HostedRole,
  Project,
} from '@release-harbor/contracts'
import {
  DomainError,
  validateApplication,
  validateBindingUpdate,
  validateChannelBinding,
  validateProject,
} from '@release-harbor/domain'
import { hostedId, hostedMemberInput } from './identity.ts'
import type { HostedScope } from './session-store.ts'

const projectFields =
  'id, workspace_id AS "workspaceId", name, key, framework, description, created_at AS "createdAt"'
const applicationFields =
  'id, workspace_id AS "workspaceId", project_id AS "projectId", name, platform, identifier, created_at AS "createdAt"'
const bindingFields = `id, workspace_id AS "workspaceId", project_id AS "projectId", application_id AS "applicationId",
  channel, app_id AS "appId", credential_reference AS "credentialReference", revision,
  'not_checked' AS verification, created_at AS "createdAt", updated_at AS "updatedAt"`

/** 使用可信空间事务读取或修改目录；不会加载凭据、调用商店或接受客户端归属。 */
export class HostedCatalog {
  constructor(private readonly issuer: string) {}

  /** 安全投影仅包含显示名、角色和当前空间内的成员 ID。 */
  async members({ client, workspaceId }: HostedScope): Promise<HostedMember[]> {
    const result = await client.query<HostedMember>(
      'SELECT id, label, role FROM rh_hosted.members WHERE workspace_id = $1 ORDER BY label, id',
      [workspaceId],
    )
    return result.rows
  }

  /** 按配置的发行者预登记成员，不发送邮件或接收可替代 subject 的字段。 */
  async addMember({ client, workspaceId }: HostedScope, input: unknown): Promise<HostedMember> {
    const data = hostedMemberInput(input)
    const result = await client.query<HostedMember>(
      `INSERT INTO rh_hosted.members (workspace_id, id, issuer, subject, label, role)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, label, role`,
      [workspaceId, randomUUID(), this.issuer, data.subject, data.label, data.role],
    )
    return inserted(result.rows)
  }

  /** 修改或撤销成员；调用方需持有空间写锁以保护最后一个管理员。 */
  async setMember(
    { client, workspaceId }: HostedScope,
    memberId: string,
    role: HostedRole | undefined,
  ): Promise<void> {
    const id = hostedId(memberId)
    const existing = await client.query<{ role: HostedRole }>(
      'SELECT role FROM rh_hosted.members WHERE workspace_id = $1 AND id = $2',
      [workspaceId, id],
    )
    const current = existing.rows[0]
    if (!current) throw new DomainError('成员不存在', 404)
    if (current.role === 'admin' && role !== 'admin') {
      const other = await client.query(
        `SELECT id FROM rh_hosted.members
         WHERE workspace_id = $1 AND role = 'admin' AND id <> $2 LIMIT 1`,
        [workspaceId, id],
      )
      if (!other.rowCount) throw new DomainError('至少保留一位工作空间管理员', 409)
    }
    if (role)
      await client.query(
        'UPDATE rh_hosted.members SET role = $3 WHERE workspace_id = $1 AND id = $2',
        [workspaceId, id, role],
      )
    else
      await client.query('DELETE FROM rh_hosted.members WHERE workspace_id = $1 AND id = $2', [
        workspaceId,
        id,
      ])
  }

  /** 读取本空间项目；顺序稳定，项目 key 可在不同空间复用。 */
  async projects({ client, workspaceId }: HostedScope): Promise<Project[]> {
    const result = await client.query<WithDates<Project>>(
      `SELECT ${projectFields} FROM rh_hosted.projects WHERE workspace_id = $1 ORDER BY created_at, id`,
      [workspaceId],
    )
    return result.rows.map(withCreated)
  }

  /** 按完整空间和项目身份读取，不泄露其他空间是否拥有相同 ID。 */
  async project({ client, workspaceId }: HostedScope, projectId: string): Promise<Project> {
    const result = await client.query<WithDates<Project>>(
      `SELECT ${projectFields} FROM rh_hosted.projects WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, hostedId(projectId)],
    )
    if (!result.rows[0]) throw new DomainError('项目不存在', 404)
    return withCreated(result.rows[0])
  }

  /** 复用现有领域项目校验；唯一性由数据库保护。 */
  async addProject({ client, workspaceId }: HostedScope, input: unknown): Promise<Project> {
    const data = validateProject(input)
    const result = await client.query<WithDates<Project>>(
      `INSERT INTO rh_hosted.projects (workspace_id, id, name, key, framework, description)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${projectFields}`,
      [workspaceId, randomUUID(), data.name, data.key, data.framework, data.description ?? ''],
    )
    return withCreated(inserted(result.rows))
  }

  /** 确认父项目存在后列出应用；其他空间或父级的项目不会返回空列表。 */
  async applications(scope: HostedScope, projectId: string): Promise<Application[]> {
    const project = await this.project(scope, projectId)
    const result = await scope.client.query<WithDates<Application>>(
      `SELECT ${applicationFields} FROM rh_hosted.applications
       WHERE workspace_id = $1 AND project_id = $2 ORDER BY created_at, id`,
      [scope.workspaceId, project.id],
    )
    return result.rows.map(withCreated)
  }

  /** 按空间和项目定位一个 Android 应用。 */
  async application(
    scope: HostedScope,
    projectId: string,
    applicationId: string,
  ): Promise<Application> {
    const result = await scope.client.query<WithDates<Application>>(
      `SELECT ${applicationFields} FROM rh_hosted.applications
       WHERE workspace_id = $1 AND project_id = $2 AND id = $3`,
      [scope.workspaceId, hostedId(projectId), hostedId(applicationId)],
    )
    if (!result.rows[0]) throw new DomainError('应用不存在', 404)
    return withCreated(result.rows[0])
  }

  /** 本切片只接收 Android 应用，不把本机平台范围带入试点。 */
  async addApplication(
    scope: HostedScope,
    projectId: string,
    input: unknown,
  ): Promise<Application> {
    const project = await this.project(scope, projectId)
    const data = validateApplication(input)
    if (data.platform !== 'android') throw new DomainError('在线目录目前只支持 Android 应用')
    const result = await scope.client.query<WithDates<Application>>(
      `INSERT INTO rh_hosted.applications (workspace_id, project_id, id, name, platform, identifier)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${applicationFields}`,
      [scope.workspaceId, project.id, randomUUID(), data.name, data.platform, data.identifier],
    )
    return withCreated(inserted(result.rows))
  }

  /** 返回当前应用的配置记录，不进行账号或目标核验。 */
  async bindings(scope: HostedScope, projectId: string, appId: string): Promise<ChannelBinding[]> {
    const app = await this.application(scope, projectId, appId)
    const result = await scope.client.query<DbBinding>(
      `SELECT ${bindingFields} FROM rh_hosted.bindings
       WHERE workspace_id = $1 AND project_id = $2 AND application_id = $3`,
      [scope.workspaceId, app.projectId, app.id],
    )
    return result.rows.map(bindingView)
  }

  /** 新增华为配置引用；已配置状态不能用来推断商店鉴权或发布能力。 */
  async addBinding(
    scope: HostedScope,
    projectId: string,
    appId: string,
    input: unknown,
  ): Promise<ChannelBinding> {
    const app = await this.application(scope, projectId, appId)
    const data = validateChannelBinding(input)
    if (data.channel !== 'huawei') throw new DomainError('在线目录目前只支持华为 Android 绑定')
    assertHuaweiTarget(data.appId)
    const result = await scope.client.query<DbBinding>(
      `INSERT INTO rh_hosted.bindings
         (workspace_id, project_id, application_id, id, channel, app_id, credential_reference)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${bindingFields}`,
      [
        scope.workspaceId,
        app.projectId,
        app.id,
        randomUUID(),
        data.channel,
        data.appId,
        data.credentialReference,
      ],
    )
    return bindingView(inserted(result.rows))
  }

  /** 在数据库更新语句中比较 revision；旧页面不能覆盖新配置。 */
  async updateBinding(
    scope: HostedScope,
    projectId: string,
    appId: string,
    bindingId: string,
    input: unknown,
  ): Promise<ChannelBinding> {
    const app = await this.application(scope, projectId, appId)
    const id = hostedId(bindingId)
    const data = validateBindingUpdate(input)
    assertHuaweiTarget(data.appId)
    const params = [scope.workspaceId, app.projectId, app.id, id]
    const result = await scope.client.query<DbBinding>(
      `UPDATE rh_hosted.bindings SET app_id = $5, credential_reference = $6,
         revision = revision + 1, updated_at = clock_timestamp()
       WHERE workspace_id = $1 AND project_id = $2 AND application_id = $3 AND id = $4 AND revision = $7
       RETURNING ${bindingFields}`,
      [...params, data.appId, data.credentialReference, data.expectedRevision],
    )
    if (result.rows[0]) return bindingView(result.rows[0])
    const existing = await scope.client.query(
      `SELECT id FROM rh_hosted.bindings
       WHERE workspace_id = $1 AND project_id = $2 AND application_id = $3 AND id = $4`,
      params,
    )
    if (!existing.rowCount) throw new DomainError('绑定不存在', 404)
    throw new DomainError('配置已更新，请刷新后重新编辑', 409)
  }
}

type WithDates<T> = Omit<T, 'createdAt'> & { createdAt: Date }
type DbBinding = Omit<WithDates<ChannelBinding>, 'updatedAt'> & { updatedAt: Date }

function withCreated<T extends { createdAt: Date }>(row: T) {
  return { ...row, createdAt: row.createdAt.toISOString() }
}

function bindingView(row: DbBinding): ChannelBinding {
  return { ...withCreated(row), updatedAt: row.updatedAt.toISOString() }
}

function inserted<T>(rows: T[]): T {
  if (!rows[0]) throw new Error('数据库未返回已写入的记录')
  return rows[0]
}

function assertHuaweiTarget(appId: string) {
  if (!/^\d+$/.test(appId)) throw new DomainError('华为商店 appId 需为数字')
}
