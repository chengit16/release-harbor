/** @description 预检控制面编排，只传递引用与快照，凭据解析和商店调用均在独立进程。 */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, realpath } from 'node:fs/promises'
import {
  isProfileCatalog,
  type ProfileCatalog,
  type PreflightRecord,
  type PreflightView,
  type ArtifactRecord,
} from '@release-harbor/contracts'
import {
  ApplicationCatalog,
  DomainError,
  preflightView,
  validatePreflightInput,
} from '@release-harbor/domain'
import {
  unavailablePreflight,
  isPreflightOutcome,
  type PreflightRunner,
} from '@release-harbor/runner-local'
import { FileArtifactStore } from './artifact-store.ts'
import { ArtifactsService } from './artifacts.service.ts'
import { FilePreflightStore } from './preflight-store.ts'

/** 一次只允许一个预检，关闭和存储故障均停止新任务；不自动重试网络。 */
export class PreflightsService {
  private busy = false
  private closing = false
  private faulty = false
  private background: Promise<void> | null = null
  constructor(
    private readonly applications: ApplicationCatalog,
    private readonly artifacts: ArtifactsService,
    private readonly artifactStore: FileArtifactStore,
    private readonly store: FilePreflightStore,
    private readonly runner: PreflightRunner,
  ) {}

  /** 与 HTTP 一起恢复末态，未完成任务只记录中断。 */
  async onModuleInit(): Promise<void> {
    await this.store.initialize()
  }
  /** 杀死本机 worker 后等待最后一次安全记录落盘。 */
  async onModuleDestroy(): Promise<void> {
    this.closing = true
    this.runner.close()
    await this.background
  }
  private assertHealthy(): void {
    if (this.closing || this.faulty)
      throw new DomainError('预检服务暂不可用，请检查存储后重启', 503)
  }

  /** 查询目录不发起远端鉴权，未知输出不当作可用目录。 */
  async profiles(): Promise<ProfileCatalog> {
    this.assertHealthy()
    const result = await this.runner.catalog().catch(() => null)
    return isProfileCatalog(result) ? result : { code: 'storage_unavailable', profiles: [] }
  }

  /** 安全读取通过结果关联的实际文件，磁盘变动不能仅靠数据库摘要蒙混通过。 */
  private async bytesMatch(record: ArtifactRecord): Promise<boolean> {
    try {
      const paths = this.artifactStore.paths(record)
      for (const path of [this.artifactStore.storageRoot(), paths.directory, paths.payload]) {
        const stat = await lstat(path)
        if (stat.isSymbolicLink() || (await realpath(path)) !== path) return false
      }
      const before = await lstat(paths.payload)
      if (!before.isFile() || before.size !== record.sizeBytes) return false
      const hash = createHash('sha256')
      for await (const chunk of createReadStream(paths.payload)) hash.update(chunk)
      const after = await lstat(paths.payload)
      return (
        hash.digest('hex') === record.sha256 &&
        before.ino === after.ino &&
        before.mtimeMs === after.mtimeMs &&
        before.ctimeMs === after.ctimeMs
      )
    } catch {
      return false
    }
  }

  /** 每次查询重算依赖和五分钟有效期，不修改历史事实，不重新请求商店。 */
  async list(
    workspaceId: string,
    projectId: string,
    applicationId: string,
  ): Promise<PreflightView[]> {
    this.assertHealthy()
    const bindings = await this.applications.bindings(workspaceId, projectId, applicationId)
    const records = await this.store.list(workspaceId, projectId, applicationId)
    const artifacts = await this.artifacts.list(workspaceId, projectId, applicationId)
    const catalog = await this.profiles()
    const checked = new Map<string, boolean>()
    const views: PreflightView[] = []
    for (const record of records) {
      const artifact = artifacts.find((a) => a.id === record.artifactId)
      if (record.status === 'passed' && artifact && !checked.has(artifact.id))
        checked.set(artifact.id, await this.bytesMatch(artifact))
      views.push(
        preflightView(
          record,
          bindings.find((b) => b.id === record.bindingId),
          artifact,
          catalog,
          Date.now(),
          checked.get(record.artifactId) ?? record.status !== 'passed',
        ),
      )
    }
    return views
  }

  /** 只接收已存在对象的引用及版本；登记 running 后才启动独立进程。 */
  async start(
    workspaceId: string,
    projectId: string,
    applicationId: string,
    body: unknown,
  ): Promise<PreflightRecord> {
    // 1. 先核对全部父级、可用产物和旧版本，尚不分配任务或访问凭据。
    this.assertHealthy()
    const input = validatePreflightInput(body)
    const app = await this.applications.get(workspaceId, projectId, applicationId)
    const binding = (await this.applications.bindings(workspaceId, projectId, applicationId)).find(
      (b) => b.id === input.bindingId,
    )
    if (!binding) throw new DomainError('商店绑定不存在', 404)
    if (binding.revision !== input.expectedBindingRevision)
      throw new DomainError('商店绑定已变化，请刷新后重试', 409)
    if (!/^\d{1,32}$/.test(binding.appId))
      throw new DomainError('只读预检需要商店的数字 App ID，请先修改绑定')
    const artifact = await this.artifacts.get(
      workspaceId,
      projectId,
      applicationId,
      input.artifactId,
    )
    if (artifact.status !== 'ready' || !artifact.sha256)
      throw new DomainError('请先选择检查通过的安装包', 409)
    const catalog = await this.profiles()
    const profile = catalog.profiles.find(
      (p) =>
        p.reference === binding.credentialReference &&
        p.channel === binding.channel &&
        p.configured,
    )
    if (!profile)
      throw new DomainError('没有可用的匹配凭据，请先运行 pnpm credentials add 并刷新目录', 409)
    if (profile.revision !== input.expectedProfileRevision)
      throw new DomainError('凭据目录已变化，请刷新后重试', 409)
    this.assertHealthy()
    if (this.busy) throw new DomainError('已有只读预检正在进行，请稍后重试', 409)
    this.busy = true
    try {
      // 2. 保存完整依赖快照，HTTP 202 不代表核验完成。
      const record: PreflightRecord = {
        id: randomUUID(),
        workspaceId,
        projectId,
        applicationId,
        bindingId: binding.id,
        bindingRevision: binding.revision,
        artifactId: artifact.id,
        artifactSha256: artifact.sha256,
        credentialReference: profile.reference,
        profileRevision: profile.revision,
        status: 'running',
        code: 'running',
        artifact: 'unverified',
        authentication: 'unverified',
        target: 'unverified',
        uploadPermission: 'not_verified',
        createdAt: new Date().toISOString(),
        checkedAt: null,
        expiresAt: null,
      }
      await this.store.save(record)
      const nonce = randomBytes(16).toString('hex')
      // 3. 私有路径只能来自服务端存储配置；所有字节和身份在 worker 内重新检查。
      this.background = Promise.resolve()
        .then(() =>
          this.runner.check({
            schemaVersion: 1,
            action: 'preflight',
            nonce,
            vaultPath: '',
            channel: binding.channel,
            appId: binding.appId,
            reference: profile.reference,
            profileRevision: profile.revision,
            inspection: {
              schemaVersion: 1,
              action: 'inspect',
              nonce,
              artifactId: artifact.id,
              storageRoot: this.artifactStore.storageRoot(),
              format: artifact.format,
              sizeBytes: artifact.sizeBytes,
              sha256: record.artifactSha256,
              target: {
                workspaceId,
                projectId,
                applicationId,
                platform: app.platform,
                identifier: app.identifier,
              },
            },
          }),
        )
        .catch(() => ({ ...unavailablePreflight }))
        .then((raw) => this.finish(record, raw))
        .catch(() => {
          this.faulty = true
        })
        .finally(() => {
          this.busy = false
        })
      return record
    } catch (error) {
      this.busy = false
      throw error
    }
  }
  /** 核验事实只接受固定投影，关闭或未知结果保持无法验证；有效期固定五分钟。 */
  private async finish(record: PreflightRecord, raw: unknown): Promise<void> {
    const result = isPreflightOutcome(raw) ? raw : { ...unavailablePreflight }
    const checkedAt = new Date().toISOString()
    const code = this.closing ? 'interrupted' : result.code
    // 只有三项均通过才可成功；网络、环境和中断均保持无法验证。
    const status =
      code === 'verified'
        ? 'passed'
        : [
              'invalid_credentials',
              'rejected',
              'application_not_found',
              'ambiguous_application',
              'application_mismatch',
              'artifact_invalid',
              'application_not_ready',
            ].includes(code)
          ? 'failed'
          : 'unverified'
    await this.store.save({
      ...record,
      ...result,
      code,
      status,
      checkedAt,
      expiresAt: new Date(Date.parse(checkedAt) + 5 * 60_000).toISOString(),
    })
  }
}
