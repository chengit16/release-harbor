/** @description 独立商店查询用例；可信绑定恢复目标，显式查询进入固定 worker，不依赖发布记录。 */
import { createHash } from 'node:crypto'
import { DomainError, ApplicationCatalog, type ProjectStore } from '@release-harbor/domain'
import {
  isStoreStatusSnapshot,
  isStoreVersionQuery,
  isStoreManualInput,
  type StoreManualRecord,
  type StoreVersionQuery,
  type ChannelBinding,
  type StoreStatusResponse,
  type StoreStatusSnapshot,
  type StoreStatusTarget,
} from '@release-harbor/contracts'
import type { StoreStatusRunner } from '@release-harbor/runner-local'
import { StoreStatusStore } from './store-status-store.ts'

const supported = new Set([
  'meizu',
  'honor',
  'vivo',
  'app_store',
  'oppo',
  'tencent',
  'harmony',
  'huawei',
  'xiaomi',
])
const notices: Partial<Record<ChannelBinding['channel'], string>> = {
  huawei: '读取华为 Android 全网发布状态；当前流程与旧在架版本分别展示，不混用鸿蒙或测试发布状态。',
  xiaomi:
    '仅查询小米官方公开在架版本；小米暂未开放审核进度接口，公开在架不代表当前送审版本审核通过。',
  oppo: '支持在详情按构建号定位查询；默认读取官方最新版本。按官方字典展示返回版本的审核状态；资质／运营通过不代表整包通过，旧版上线不证明新送审包通过，请核对版本与构建号。',
  vivo: '按官方审核字典展示；仅审核通过时结合上架状态，旧包在架不会覆盖当前待审或拒绝。',
  tencent: '审核流程与版本资料分别展示；官方审核接口不返回版本号，审核通过不等于已上架。',
  harmony: '读取鸿蒙全网发布状态；当前流程与旧在架版本分别展示，不混用 Android 或测试发布状态。',
  meizu: '官方版本目录未提供构建号；按商店版本 ID 区分，不从本机记录补猜。',
}

function cacheKey(binding: ChannelBinding, identifier: string): string {
  return createHash('sha256').update(JSON.stringify({ binding, identifier })).digest('hex')
}

/** 本地目录与官方查询隔离；同绑定请求先预约，结果复核身份及配置后才归档。 */
export class StoreStatusService {
  constructor(
    private readonly projects: ProjectStore,
    private readonly applications: ApplicationCatalog,
    private readonly snapshots: StoreStatusStore,
    private readonly runner: StoreStatusRunner,
    private readonly origins: readonly string[] = [],
  ) {}

  /** 来源标记仅保护本机显式查询，不作为在线用户认证或发布许可。 */
  assertSource(origin: unknown, marker: unknown): void {
    if (typeof origin !== 'string' || !this.origins.includes(origin) || marker !== '1')
      throw new DomainError('请从本机工作台明确发起商店查询', 403)
  }

  private async target(projectId: string, applicationId: string, bindingId: string) {
    const application = await this.applications.get('local', projectId, applicationId)
    const binding = (await this.applications.bindings('local', projectId, applicationId)).find(
      (item) => item.id === bindingId,
    )
    if (!binding) throw new DomainError('商店绑定不存在', 404)
    return { application, binding }
  }

  /** 汇总绑定及缓存；没有本机发布记录的应用也展示，不触发商店调用。 */
  async list(): Promise<StoreStatusResponse> {
    const targets: StoreStatusTarget[] = [],
      keys: string[] = []
    for (const project of await this.projects.list('local')) {
      for (const application of await this.applications.list('local', project.id)) {
        for (const binding of await this.applications.bindings(
          'local',
          project.id,
          application.id,
        )) {
          targets.push({
            bindingId: binding.id,
            projectId: project.id,
            projectName: project.name,
            applicationId: application.id,
            applicationName: application.name,
            platform: application.platform,
            identifier: application.identifier,
            channel: binding.channel,
            appId: binding.appId,
            querySupported: supported.has(binding.channel),
            queryNotice: notices[binding.channel] ?? null,
          })
          keys.push(cacheKey(binding, application.identifier))
        }
      }
    }
    return {
      targets,
      ...(await this.snapshots.tracking(keys)),
    }
  }

  /** 只读目标从绑定恢复；查询前持久预约，查询后拒绝配置变化或错目标回报。 */
  async query(
    projectId: string,
    applicationId: string,
    bindingId: string,
    query?: StoreVersionQuery,
  ): Promise<StoreStatusSnapshot> {
    // 1. 不读取计划、产物或授权；官网手动提交的版本同样可查询。
    const { application, binding } = await this.target(projectId, applicationId, bindingId)
    if (!supported.has(binding.channel))
      throw new DomainError(notices[binding.channel] ?? '当前渠道暂不支持状态查询', 409)
    const expectedPlatform =
      binding.channel === 'app_store'
        ? 'ios'
        : binding.channel === 'harmony'
          ? 'harmony'
          : 'android'
    if (application.platform !== expectedPlatform)
      throw new DomainError('商店与应用平台不匹配', 409)
    if (query && (!isStoreVersionQuery(query) || binding.channel !== 'oppo'))
      throw new DomainError('当前只有 OPPO 支持按构建号定位查询', 409)
    const key = cacheKey(binding, application.identifier)
    await this.snapshots.reserve(key)
    // 2. worker 异常仅保存固定失败，不传播商店正文、凭据或执行器路径。
    let snapshot: StoreStatusSnapshot
    try {
      snapshot = await this.runner.run({
        binding,
        identifier: application.identifier,
        ...(query ? { query } : {}),
      })
    } catch {
      snapshot = {
        bindingId,
        channel: binding.channel,
        ...(query ? { query } : {}),
        checkedAt: new Date().toISOString(),
        code: 'network',
        versions: [],
      }
    }
    if (
      !isStoreStatusSnapshot(snapshot) ||
      snapshot.bindingId !== bindingId ||
      snapshot.channel !== binding.channel ||
      JSON.stringify(snapshot.query ?? null) !== JSON.stringify(query ?? null)
    )
      snapshot = {
        bindingId,
        channel: binding.channel,
        ...(query ? { query } : {}),
        checkedAt: new Date().toISOString(),
        code: 'invalid_response',
        versions: [],
      }
    // 3. 改绑期间的结果不能挂到新目标；旧指纹快照保留但不再出现在当前目录。
    const current = await this.target(projectId, applicationId, bindingId)
    await this.snapshots.finish(key, snapshot)
    if (cacheKey(current.binding, current.application.identifier) !== key)
      throw new DomainError('查询期间商店绑定已变化，请重新读取目录', 409)
    return snapshot
  }

  /** 小米无官方审核 API，保存人工来源与时间；不解除原未知执行保护。 */
  async saveManual(
    projectId: string,
    applicationId: string,
    bindingId: string,
    input: unknown,
  ): Promise<StoreManualRecord> {
    if (!isStoreManualInput(input))
      throw new DomainError('请填写合法的版本、状态、核对时间和简短备注')
    const { application, binding } = await this.target(projectId, applicationId, bindingId)
    if (binding.channel !== 'xiaomi' || application.platform !== 'android')
      throw new DomainError('当前仅小米支持补充人工核对记录', 409)
    const createdAt = new Date().toISOString()
    if (Date.parse(input.checkedAt) > Date.parse(createdAt))
      throw new DomainError('核对时间不能晚于当前时间')
    const key = cacheKey(binding, application.identifier)
    const record = await this.snapshots.saveManual(key, {
      ...input,
      bindingId,
      source: 'local_user',
      createdAt,
    })
    const current = await this.target(projectId, applicationId, bindingId)
    if (cacheKey(current.binding, current.application.identifier) !== key)
      throw new DomainError('保存期间商店绑定已变化，请重新读取目录', 409)
    return record
  }

  /** Nest 关闭时终止宿主 worker；不会重试商店查询。 */
  onModuleDestroy(): void {
    this.runner.close()
  }
}
