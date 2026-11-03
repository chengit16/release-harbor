/**
 * @description 单进程应用与绑定存储
 * 与旧项目文件隔离；同一队列保护唯一性和版本，损坏状态拒绝写入。
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  isApplication,
  isChannelBinding,
  isRecord,
  type Application,
  type ChannelBinding,
  type UpdateChannelBinding,
} from '@release-harbor/contracts'
import {
  assertChannelMatches,
  DomainError,
  validateApplication,
  validateChannelBinding,
  type ApplicationStore,
} from '@release-harbor/domain'

interface State {
  schemaVersion: 1
  applications: Application[]
  bindings: ChannelBinding[]
}

function exactKeys(value: object, keys: string[]): boolean {
  return (
    Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key))
  )
}
function timestamp(value: string): boolean {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) && date.toISOString() === value
}
function assertUnique(keys: string[]): void {
  if (new Set(keys).size !== keys.length) throw new Error('invalid store uniqueness')
}

/** 已有记录必须保持规范形态，不能在读取时偷偷裁剪或规范化。 */
function validateApplicationRecord(application: Application): void {
  if (
    !exactKeys(application, [
      'id',
      'workspaceId',
      'projectId',
      'name',
      'platform',
      'identifier',
      'createdAt',
    ]) ||
    !timestamp(application.createdAt)
  )
    throw new Error('invalid application record')
  const valid = validateApplication({
    name: application.name,
    platform: application.platform,
    identifier: application.identifier,
  })
  if (valid.name !== application.name || valid.identifier !== application.identifier)
    throw new Error('invalid canonical identity')
}

/** 恢复绑定时重验归属与平台，不能把悬挂或错配记录重新激活。 */
function validateBindingRecord(binding: ChannelBinding, applications: Application[]): void {
  if (
    !exactKeys(binding, [
      'id',
      'workspaceId',
      'projectId',
      'applicationId',
      'channel',
      'appId',
      'credentialReference',
      'revision',
      'verification',
      'createdAt',
      'updatedAt',
    ]) ||
    !timestamp(binding.createdAt) ||
    !timestamp(binding.updatedAt)
  )
    throw new Error('invalid binding record')
  const application = applications.find(
    (app) =>
      app.id === binding.applicationId &&
      app.workspaceId === binding.workspaceId &&
      app.projectId === binding.projectId,
  )
  if (!application) throw new Error('invalid binding owner')
  assertChannelMatches(application, binding.channel)
  const valid = validateChannelBinding({
    channel: binding.channel,
    appId: binding.appId,
    credentialReference: binding.credentialReference,
  })
  if (valid.appId !== binding.appId || valid.credentialReference !== binding.credentialReference)
    throw new Error('invalid canonical binding')
}

/** 在持久化边界核对全部结构与关联，防止损坏数据被继续写回。 */
function decodeState(value: unknown): State {
  // 1. 先检查版本及结构，未知版本必须停止而不是尝试覆盖。
  if (
    !isRecord(value) ||
    !exactKeys(value, ['schemaVersion', 'applications', 'bindings']) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.applications) ||
    !Array.isArray(value.bindings) ||
    !value.applications.every(isApplication) ||
    !value.bindings.every(isChannelBinding)
  )
    throw new Error('invalid store schema')
  const applications = value.applications
  const bindings = value.bindings
  // 2. 每项重验领域约束和关联，防止类型正确但业务无效的持久数据通过。
  applications.forEach(validateApplicationRecord)
  bindings.forEach((binding) => validateBindingRecord(binding, applications))
  // 3. 既有文件同样必须满足唯一性，不能仅保护新增写入。
  assertUnique(applications.map((app) => app.id))
  assertUnique(
    applications.map((app) => JSON.stringify([app.workspaceId, app.platform, app.identifier])),
  )
  assertUnique(bindings.map((binding) => binding.id))
  assertUnique(bindings.map((binding) => JSON.stringify([binding.applicationId, binding.channel])))
  assertUnique(
    bindings.map((binding) =>
      JSON.stringify([binding.workspaceId, binding.channel, binding.appId]),
    ),
  )
  return { schemaVersion: 1, applications, bindings }
}

/** 原子保存应用与绑定；只适用于一个服务进程和同一 Store 实例。 */
export class FileApplicationStore implements ApplicationStore {
  private pending: Promise<unknown> = Promise.resolve()
  constructor(private readonly file: string) {}

  private async read(): Promise<State> {
    try {
      return decodeState(JSON.parse(await readFile(this.file, 'utf8')))
    } catch (error) {
      if (isRecord(error) && error.code === 'ENOENT')
        return { schemaVersion: 1, applications: [], bindings: [] }
      throw new DomainError('应用数据无法读取，请检查存储文件或从备份恢复', 500)
    }
  }

  private mutate<T>(change: (state: State) => T): Promise<T> {
    const operation = this.pending.then(async () => {
      // 1. 每次写入重新读取有效状态，唯一性和版本比较均位于相同队列中。
      const state = await this.read()
      const result = change(state)
      decodeState(state)
      // 2. 同目录替换避免半文件，异常时清除本次临时文件但不改动旧数据。
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 })
      const temporary = `${this.file}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o600 })
        await rename(temporary, this.file)
      } finally {
        await rm(temporary, { force: true })
      }
      return result
    })
    // 仅恢复后续队列；本次 operation 仍向调用方返回原始失败。
    this.pending = operation.catch(() => undefined)
    return operation
  }

  /** 与绑定写入串行，禁止检查之后、删除完成之前插入新的关联。 */
  withUnboundCredential<T>(
    workspaceId: string,
    reference: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const operation = this.pending.then(async () => {
      const state = await this.read()
      if (
        state.bindings.some(
          (b) => b.workspaceId === workspaceId && b.credentialReference === reference,
        )
      )
        throw new DomainError('账号仍有关联应用，请先将商店绑定改用其他账号', 409)
      return action()
    })
    this.pending = operation.catch(() => undefined)
    return operation
  }

  async list(workspaceId: string, projectId: string): Promise<Application[]> {
    await this.pending
    return (await this.read()).applications.filter(
      (app) => app.workspaceId === workspaceId && app.projectId === projectId,
    )
  }

  async get(workspaceId: string, projectId: string, id: string): Promise<Application | undefined> {
    return (await this.list(workspaceId, projectId)).find((app) => app.id === id)
  }

  create(application: Application): Promise<Application> {
    return this.mutate((state) => {
      if (
        state.applications.some(
          (app) =>
            app.workspaceId === application.workspaceId &&
            app.platform === application.platform &&
            app.identifier === application.identifier,
        )
      )
        throw new DomainError('当前工作空间已登记相同平台与包身份的应用', 409)
      state.applications.push(application)
      return application
    })
  }

  async listBindings(
    workspaceId: string,
    projectId: string,
    applicationId: string,
  ): Promise<ChannelBinding[]> {
    await this.pending
    return (await this.read()).bindings.filter(
      (binding) =>
        binding.workspaceId === workspaceId &&
        binding.projectId === projectId &&
        binding.applicationId === applicationId,
    )
  }

  private assertTargetAvailable(state: State, binding: ChannelBinding): void {
    if (
      state.bindings.some(
        (other) =>
          other.id !== binding.id &&
          other.workspaceId === binding.workspaceId &&
          other.channel === binding.channel &&
          (other.applicationId === binding.applicationId || other.appId === binding.appId),
      )
    )
      throw new DomainError('该应用已绑定此商店，或商店 appId 已被其他应用使用', 409)
  }

  createBinding(binding: ChannelBinding): Promise<ChannelBinding> {
    return this.mutate((state) => {
      this.assertTargetAvailable(state, binding)
      state.bindings.push(binding)
      return binding
    })
  }

  updateBinding(
    workspaceId: string,
    projectId: string,
    applicationId: string,
    id: string,
    input: UpdateChannelBinding,
  ): Promise<ChannelBinding> {
    return this.mutate((state) => {
      const binding = state.bindings.find(
        (item) =>
          item.id === id &&
          item.workspaceId === workspaceId &&
          item.projectId === projectId &&
          item.applicationId === applicationId,
      )
      if (!binding) throw new DomainError('商店绑定不存在', 404)
      if (binding.revision !== input.expectedRevision)
        throw new DomainError('配置已被修改，请刷新当前配置并核对后重新保存', 409)
      const updated: ChannelBinding = {
        ...binding,
        appId: input.appId,
        credentialReference: input.credentialReference,
        revision: binding.revision + 1,
        updatedAt: new Date().toISOString(),
        verification: 'not_checked',
      }
      this.assertTargetAvailable(state, updated)
      Object.assign(binding, updated)
      return updated
    })
  }
}
