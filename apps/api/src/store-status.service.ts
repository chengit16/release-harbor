/** @description 独立商店查询用例；可信绑定恢复目标，显式查询进入固定 worker，不依赖发布记录。 */
import { createHash } from 'node:crypto'
import { DomainError, ApplicationCatalog, type ProjectStore } from '@release-harbor/domain'
import {
  isStoreStatusSnapshot,
  type ChannelBinding,
  type StoreStatusResponse,
  type StoreStatusSnapshot,
  type StoreStatusTarget,
} from '@release-harbor/contracts'
import type { StoreStatusRunner } from '@release-harbor/runner-local'
import { StoreStatusStore } from './store-status-store.ts'

const supported = new Set(['meizu', 'honor', 'vivo', 'app_store', 'oppo', 'tencent', 'harmony'])
const notices: Partial<Record<ChannelBinding['channel'], string>> = {
  huawei: '华为 Android 独立状态查询尚待核实接入，请到商店后台核对。',
  xiaomi: '小米公开接口暂未提供审核状态查询，请到商店后台核对；更新许可不代表审核结果。',
  oppo: '当前可读取官方最新版本资料，完整审核状态字典尚待核实，审核阶段显示为尚无法确认。',
  vivo: '当前可确认待审核状态；其他状态尚待核实，不使用旧版本在架情况推断当前审核结果。',
  tencent: '当前可读取官方版本资料，审核阶段尚无法确认，请到应用宝后台核对。',
  harmony: '当前可读取官方正式版本资料，审核阶段尚无法确认，请到 AppGallery Connect 核对。',
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
    return { targets, snapshots: await this.snapshots.list(keys) }
  }

  /** 只读目标从绑定恢复；查询前持久预约，查询后拒绝配置变化或错目标回报。 */
  async query(
    projectId: string,
    applicationId: string,
    bindingId: string,
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
    const key = cacheKey(binding, application.identifier)
    await this.snapshots.reserve(key)
    // 2. worker 异常仅保存固定失败，不传播商店正文、凭据或执行器路径。
    let snapshot: StoreStatusSnapshot
    try {
      snapshot = await this.runner.run({ binding, identifier: application.identifier })
    } catch {
      snapshot = {
        bindingId,
        channel: binding.channel,
        checkedAt: new Date().toISOString(),
        code: 'network',
        versions: [],
      }
    }
    if (
      !isStoreStatusSnapshot(snapshot) ||
      snapshot.bindingId !== bindingId ||
      snapshot.channel !== binding.channel
    )
      snapshot = {
        bindingId,
        channel: binding.channel,
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

  /** Nest 关闭时终止宿主 worker；不会重试商店查询。 */
  onModuleDestroy(): void {
    this.runner.close()
  }
}
