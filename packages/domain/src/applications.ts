/**
 * @description 应用与商店配置规则及用例
 * 可信归属来自调用方；存储端口必须在写入边界再次保护唯一性与版本。
 */
import { randomUUID } from 'node:crypto'
import {
  isRecord,
  type Application,
  type ChannelBinding,
  type CreateApplication,
  type CreateChannelBinding,
  type UpdateChannelBinding,
} from '@release-harbor/contracts'
import type { ProjectStore } from './index.ts'
import { DomainError } from './errors.ts'

/** 应用／绑定存储端口。所有读取限定工作空间及父对象，写入冲突返回 409。 */
export interface ApplicationStore {
  list(workspaceId: string, projectId: string): Promise<Application[]>
  get(workspaceId: string, projectId: string, id: string): Promise<Application | undefined>
  create(application: Application): Promise<Application>
  listBindings(
    workspaceId: string,
    projectId: string,
    applicationId: string,
  ): Promise<ChannelBinding[]>
  createBinding(binding: ChannelBinding): Promise<ChannelBinding>
  /** 在绑定写队列内核对引用未被使用，再执行本机删除；不构成跨进程事务。 */
  withUnboundCredential<T>(
    workspaceId: string,
    reference: string,
    action: () => Promise<T>,
  ): Promise<T>
  /** 必须在同一写入边界比较版本后递增，不能先查后无条件覆盖。 */
  updateBinding(
    workspaceId: string,
    projectId: string,
    applicationId: string,
    id: string,
    input: UpdateChannelBinding,
  ): Promise<ChannelBinding>
}

function fields(input: unknown, allowed: string[]): Record<string, unknown> {
  if (!isRecord(input) || Object.keys(input).some((key) => !allowed.includes(key)))
    throw new DomainError('资料格式不正确或包含不支持的字段')
  return input
}
function text(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    throw new DomainError(`${label}需为 1–${max} 个字符`)
  return value.trim()
}

/** 校验产品支持的包身份格式；不据此认定与安装包或远端应用一致。 */
export function validateApplication(input: unknown): CreateApplication {
  const data = fields(input, ['name', 'platform', 'identifier'])
  const name = text(data.name, 60, '应用名称')
  if (data.platform !== 'android' && data.platform !== 'ios')
    throw new DomainError('请选择 Android 或 iOS 平台')
  const identifier = text(data.identifier, 255, '包身份')
  const pattern =
    data.platform === 'android'
      ? /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/
      : /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/
  if (!pattern.test(identifier))
    throw new DomainError('包身份需使用点分隔的合法标识，不能包含路径或通配符')
  return { name, platform: data.platform, identifier }
}

function bindingValues(
  data: Record<string, unknown>,
): Pick<CreateChannelBinding, 'appId' | 'credentialReference'> {
  const appId = text(data.appId, 128, '商店 appId')
  const credentialReference = text(data.credentialReference, 64, '凭据引用')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(appId))
    throw new DomainError('商店 appId 仅允许字母、数字、点、下划线与短横线')
  if (!/^[A-Za-z][A-Za-z0-9._-]*$/.test(credentialReference))
    throw new DomainError('凭据引用需以字母开头，仅填写别名，不填写密码、路径或 JSON')
  return { appId, credentialReference }
}

/** 校验首批渠道配置；引用格式合法不代表凭据有效。 */
export function validateChannelBinding(input: unknown): CreateChannelBinding {
  const data = fields(input, ['channel', 'appId', 'credentialReference'])
  if (
    data.channel !== 'huawei' &&
    data.channel !== 'app_store' &&
    data.channel !== 'xiaomi' &&
    data.channel !== 'oppo' &&
    data.channel !== 'vivo'
  )
    throw new DomainError('当前只支持华为、Apple、小米、OPPO 和 vivo 商店绑定')
  return { channel: data.channel, ...bindingValues(data) }
}

/** 校验乐观并发条件，拒绝客户端修改渠道、归属和预检状态。 */
export function validateBindingUpdate(input: unknown): UpdateChannelBinding {
  const data = fields(input, ['appId', 'credentialReference', 'expectedRevision'])
  if (
    typeof data.expectedRevision !== 'number' ||
    !Number.isSafeInteger(data.expectedRevision) ||
    data.expectedRevision < 1 ||
    data.expectedRevision >= Number.MAX_SAFE_INTEGER
  )
    throw new DomainError('请提供有效的配置版本')
  return { ...bindingValues(data), expectedRevision: data.expectedRevision }
}

/** 限制首批平台与商店的匹配，不把配置入口扩展成未知发布能力。 */
export function assertChannelMatches(
  application: Application,
  channel: ChannelBinding['channel'],
): void {
  if (
    (application.platform === 'android' &&
      channel !== 'huawei' &&
      channel !== 'xiaomi' &&
      channel !== 'oppo' &&
      channel !== 'vivo') ||
    (application.platform === 'ios' && channel !== 'app_store')
  )
    throw new DomainError('商店与应用平台不匹配')
}

/** 协调项目、应用和绑定归属；不解析凭据、不调用商店。 */
export class ApplicationCatalog {
  constructor(
    private readonly projects: ProjectStore,
    private readonly store: ApplicationStore,
  ) {}

  private async project(workspaceId: string, projectId: string): Promise<void> {
    if (!workspaceId || !(await this.projects.get(workspaceId, projectId)))
      throw new DomainError('项目不存在', 404)
  }

  /** 列表前验证父项目，避免错误归属被静默表示为空集合。 */
  async list(workspaceId: string, projectId: string): Promise<Application[]> {
    await this.project(workspaceId, projectId)
    return this.store.list(workspaceId, projectId)
  }

  /** 同时验证工作空间与项目，不接受单独应用 ID 作为访问范围。 */
  async get(workspaceId: string, projectId: string, id: string): Promise<Application> {
    await this.project(workspaceId, projectId)
    const application = await this.store.get(workspaceId, projectId, id)
    if (!application) throw new DomainError('应用不存在', 404)
    return application
  }

  /** 创建不可变平台身份，唯一性由存储写边界保证。 */
  async create(workspaceId: string, projectId: string, input: unknown): Promise<Application> {
    await this.project(workspaceId, projectId)
    const data = validateApplication(input)
    return this.store.create({
      ...data,
      id: randomUUID(),
      workspaceId,
      projectId,
      createdAt: new Date().toISOString(),
    })
  }

  /** 只有应用归属核对后才允许读取绑定。 */
  async bindings(
    workspaceId: string,
    projectId: string,
    applicationId: string,
  ): Promise<ChannelBinding[]> {
    await this.get(workspaceId, projectId, applicationId)
    return this.store.listBindings(workspaceId, projectId, applicationId)
  }

  /** 首次保存始终未预检；目标和引用不构成执行授权。 */
  async bind(
    workspaceId: string,
    projectId: string,
    applicationId: string,
    input: unknown,
  ): Promise<ChannelBinding> {
    // 1. 核对父应用，先拒绝跨空间或跨项目访问。
    const application = await this.get(workspaceId, projectId, applicationId)
    // 2. 校验公开配置和平台能力，秘密始终留在未来执行侧。
    const data = validateChannelBinding(input)
    assertChannelMatches(application, data.channel)
    if (
      (data.channel === 'xiaomi' || data.channel === 'oppo' || data.channel === 'vivo') &&
      data.appId !== application.identifier
    )
      throw new DomainError('此商店使用应用包名定位，目标必须等于当前 Android 包名')
    // 3. 存储在串行写入中保护渠道和远端目标唯一性。
    const now = new Date().toISOString()
    return this.store.createBinding({
      ...data,
      id: randomUUID(),
      workspaceId,
      projectId,
      applicationId,
      revision: 1,
      verification: 'not_checked',
      createdAt: now,
      updatedAt: now,
    })
  }

  /** 保留旧版本冲突，调用方不能凭失效草稿覆盖他人修改。 */
  async updateBinding(
    workspaceId: string,
    projectId: string,
    applicationId: string,
    id: string,
    input: unknown,
  ): Promise<ChannelBinding> {
    const application = await this.get(workspaceId, projectId, applicationId)
    const current = (await this.store.listBindings(workspaceId, projectId, applicationId)).find(
      (b) => b.id === id,
    )
    const data = validateBindingUpdate(input)
    if (
      (current?.channel === 'xiaomi' ||
        current?.channel === 'oppo' ||
        current?.channel === 'vivo') &&
      data.appId !== application.identifier
    )
      throw new DomainError('商店目标必须等于当前 Android 包名')
    return this.store.updateBinding(workspaceId, projectId, applicationId, id, data)
  }
}
