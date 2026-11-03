/** @description 控制面产物编排，只接收受控字节并调用独立检查端口，不直接加载商店 SDK。 */
import { randomBytes, randomUUID } from 'node:crypto'
import { rename } from 'node:fs/promises'
import { Readable } from 'node:stream'
import {
  artifactLimits,
  isArtifactIdentity,
  type Application,
  type ArtifactRecord,
  type ArtifactFailureCode,
} from '@release-harbor/contracts'
import {
  ApplicationCatalog,
  artifactMatchesApplication,
  DomainError,
  validateArtifactInput,
} from '@release-harbor/domain'
import type { ArtifactInspector } from '@release-harbor/runner-local'
import { FileArtifactStore } from './artifact-store.ts'
import { ArtifactReceiveError, receiveArtifact } from './artifact-receive.ts'

/** 一条本地接收／检查槽位，跨请求共享，故障后默认关闭写入口。 */
export class ArtifactsService {
  private busy = false
  private closing = false
  private faulty = false
  private upload: Readable | null = null
  private background: Promise<void> | null = null
  constructor(
    private readonly applications: ApplicationCatalog,
    private readonly store: FileArtifactStore,
    private readonly inspector: ArtifactInspector,
  ) {}

  /** 先恢复旧任务再开放 HTTP；未知数据导致启动失败，避免静默覆盖。 */
  async onModuleInit(): Promise<void> {
    await this.store.initialize()
  }

  /** 在 HTTP 关闭前终止本地工作，不自动重新检查或重传。 */
  async onModuleDestroy(): Promise<void> {
    this.closing = true
    this.upload?.destroy(new ArtifactReceiveError('interrupted'))
    this.inspector.close()
    await this.background
  }

  private assertHealthy(): void {
    if (this.faulty || this.closing)
      throw new DomainError('产物服务暂不可用，请检查存储后重启服务', 503)
  }

  /** 全部查询先核对应用归属；不接受裸产物 ID 作为访问权限。 */
  async list(
    workspaceId: string,
    projectId: string,
    applicationId: string,
  ): Promise<ArtifactRecord[]> {
    this.assertHealthy()
    await this.applications.get(workspaceId, projectId, applicationId)
    return this.store.list(workspaceId, projectId, applicationId)
  }

  /** 只从已授权父级内查找，错误 ID 不会被用于构造路径。 */
  async get(
    workspaceId: string,
    projectId: string,
    applicationId: string,
    id: string,
  ): Promise<ArtifactRecord> {
    const record = (await this.list(workspaceId, projectId, applicationId)).find(
      (item) => item.id === id,
    )
    if (!record) throw new DomainError('产物不存在', 404)
    return record
  }

  /** 只处理原始流，不接受客户端路径、摘要或检查结果。接收后异步检查，返回不表示已可用。 */
  async receive(
    workspaceId: string,
    projectId: string,
    applicationId: string,
    name: unknown,
    size: unknown,
    body: unknown,
  ): Promise<ArtifactRecord> {
    this.assertHealthy()
    const application = await this.applications.get(workspaceId, projectId, applicationId)
    const input = validateArtifactInput(application, name, size)
    if (!(body instanceof Readable)) throw new DomainError('请使用原始安装包字节上传', 415)
    if (this.busy) {
      body.resume()
      throw new DomainError('已有安装包正在接收或检查，请等待完成后重试', 409)
    }
    this.busy = true
    this.upload = body
    let record: ArtifactRecord | null = null
    try {
      // 1. 先检查配额和空间，再分配自有记录，旧文件始终不参与覆盖。
      await this.store.assertCapacity(input.expectedSizeBytes)
      const now = new Date().toISOString()
      record = {
        ...input,
        id: randomUUID(),
        workspaceId,
        projectId,
        applicationId,
        status: 'receiving',
        sizeBytes: 0,
        sha256: null,
        identity: null,
        failureCode: null,
        createdAt: now,
        updatedAt: now,
      }
      await this.store.create(record)
      // 2. 真正接收、同步并固定摘要；checking 必须在 HTTP 202 返回前持久化。
      const paths = this.store.paths(record)
      const actual = await receiveArtifact(body, paths.partial, input.expectedSizeBytes)
      await rename(paths.partial, paths.payload)
      record = { ...record, ...actual, status: 'checking', updatedAt: new Date().toISOString() }
      await this.store.update(record)
      // 3. 独立检查不占用 HTTP 请求；后台持久化失败时停用入口，不生成假结果。
      this.background = this.inspect(record, application)
        .catch(() => {
          this.faulty = true
        })
        .finally(() => {
          this.busy = false
        })
      return record
    } catch (error) {
      if (record) {
        await this.fail(
          record,
          error instanceof ArtifactReceiveError ? error.failureCode : 'storage_failed',
        ).catch(() => {
          this.faulty = true
        })
      }
      this.busy = false
      if (error instanceof DomainError) throw error
      throw new DomainError('安装包未能完整保存，请检查磁盘后重试', 500)
    } finally {
      this.upload = null
      if (!body.destroyed) body.resume()
    }
  }

  private async fail(record: ArtifactRecord, failureCode: ArtifactFailureCode): Promise<void> {
    await this.store.clearBytes(record)
    await this.store.update({
      ...record,
      status: 'failed',
      failureCode,
      updatedAt: new Date().toISOString(),
    })
  }

  private async inspect(record: ArtifactRecord, application: Application): Promise<void> {
    if (!record.sha256) throw new Error('missing digest')
    const outcome = await this.inspector
      .inspect({
        schemaVersion: 1,
        action: 'inspect',
        nonce: randomBytes(16).toString('hex'),
        artifactId: record.id,
        storageRoot: this.store.storageRoot(),
        format: record.format,
        sizeBytes: record.sizeBytes,
        sha256: record.sha256,
        target: {
          workspaceId: record.workspaceId,
          projectId: record.projectId,
          applicationId: record.applicationId,
          platform: application.platform,
          identifier: application.identifier,
        },
      })
      .catch(() => ({ identity: null, failureCode: 'inspection_failed' as const }))
    if (this.closing) {
      await this.fail(record, 'interrupted')
      return
    }
    const identity = isArtifactIdentity(outcome.identity) ? outcome.identity : null
    let failureCode = outcome.failureCode
    if (
      !failureCode &&
      (!identity || identity.sha256 !== record.sha256 || identity.sizeBytes !== record.sizeBytes)
    )
      failureCode = 'digest_mismatch'
    if (!failureCode && identity && !artifactMatchesApplication(application, identity))
      failureCode = 'identity_mismatch'
    if (failureCode) {
      await this.fail({ ...record, identity }, failureCode)
      return
    }
    await this.store.update({
      ...record,
      identity,
      status: 'ready',
      updatedAt: new Date().toISOString(),
    })
  }
}
