/** @description 在线安装包接收、完成和回收；存储回报不充当包身份，失败保留配额。 */
import { randomUUID } from 'node:crypto'
import {
  hostedArtifactLimits as limits,
  hostedPartBytes,
  type HostedArtifact,
  type HostedArtifactLink,
  type HostedArtifactList,
} from '@release-harbor/contracts'
import { DomainError } from '@release-harbor/domain'
import { exactFields, hostedId } from '../identity.ts'
import {
  artifactHasHold,
  byUploadRequest,
  freezeHostedArtifact,
  hostedArtifactRow,
  hostedArtifactView,
  insertHostedArtifact,
  listHostedArtifacts,
  reservedArtifactBytes,
  retireHostedArtifact,
  type HostedArtifactRow,
  type HostedArtifactScope,
  type HostedIntakeInput,
} from './repository.ts'
import {
  storageCall,
  type HostedArtifactStorage,
  type HostedObject,
  type HostedStoredPart,
} from './storage.ts'

/** 在线产物状态协调；所有副作用由已核验的空间写事务调用。 */
export class HostedArtifacts {
  constructor(private readonly storage?: HostedArtifactStorage) {}

  /** 仅读取最近记录和配额，不连接对象存储。 */
  async list(scope: HostedArtifactScope): Promise<HostedArtifactList> {
    return {
      items: await listHostedArtifacts(scope),
      reservedBytes: await reservedArtifactBytes(scope),
      enabled: Boolean(this.storage),
    }
  }

  /** 先验同请求与配额，再建立独占 multipart；未持久化的上传只能由桶生命周期回收。 */
  async begin(scope: HostedArtifactScope, body: unknown): Promise<HostedArtifact> {
    const storage = this.requiredStorage()
    const input = intakeInput(body)
    const existing = await byUploadRequest(scope, input.requestId)
    if (existing) {
      if (input.fileName !== existing.fileName || input.sizeBytes !== existing.sizeBytes)
        throw new DomainError('上传请求已用于其他文件', 409)
      assertSameManifest(existing.manifest, input.manifest)
      return hostedArtifactView(existing)
    }
    if ((await reservedArtifactBytes(scope)) + input.sizeBytes > limits.workspaceBytes)
      throw new DomainError('当前工作空间安装包配额不足，请先取消或清理旧安装包', 409)
    const id = randomUUID()
    const key = `release-harbor/hosted/v1/${scope.workspaceId}/${id}.apk`
    const uploadId = await storageCall(() => storage.open(key, id))
    try {
      return await insertHostedArtifact(scope, input, id, key, uploadId)
    } catch (error) {
      // 数据库未能保存时不下发能力；尽量终止仅属于此次新记录的 multipart。
      await storageCall(() => storage.abort(key, uploadId)).catch(() => undefined)
      throw error
    }
  }

  /** 显式继续时对比重选文件清单和真实已存分片；不信任浏览器进度。 */
  async resume(
    scope: HostedArtifactScope,
    id: string,
    body: unknown,
  ): Promise<{ completedParts: number[] }> {
    const storage = this.requiredStorage()
    const row = await hostedArtifactRow(scope, id)
    assertSameManifest(row.manifest, exactFields(body, ['manifest']).manifest)
    if (row.status === 'awaiting_check')
      return { completedParts: row.manifest.map((_, index) => index + 1) }
    assertReceiving(row)
    // 完成可能已到达存储而响应中断；让客户端显式调用完成，重新核对该对象。
    const head = await storageCall(() => storage.head(row.objectKey))
    if (head) {
      objectVersion(row, head)
      return { completedParts: row.manifest.map((_, index) => index + 1) }
    }
    const parts = await storageCall(() => storage.parts(row.objectKey, row.uploadId))
    return { completedParts: checkedParts(row, parts).map((part) => part.number) }
  }

  /** 每次只签一个片号；有效期不超过接收期限。 */
  async part(scope: HostedArtifactScope, id: string, body: unknown): Promise<HostedArtifactLink> {
    const storage = this.requiredStorage()
    const row = await hostedArtifactRow(scope, id)
    assertReceiving(row)
    const { part } = exactFields(body, ['part'])
    if (
      typeof part !== 'number' ||
      !Number.isInteger(part) ||
      part < 1 ||
      part > row.manifest.length
    )
      throw new DomainError('分片编号超出此安装包范围')
    const checksum = row.manifest[part - 1]
    if (!checksum) throw new Error('安装包分片清单不完整')
    const seconds = Math.min(limits.partLinkSeconds, row.secondsLeft)
    return {
      url: await storageCall(() =>
        storage.partLink(
          row.objectKey,
          row.uploadId,
          part,
          hostedPartBytes(row.sizeBytes, part),
          checksum,
          seconds,
        ),
      ),
    }
  }

  /** 先恢复可能已完成的唯一对象；否则核对真实分片再提交和读回固定版本。 */
  async complete(scope: HostedArtifactScope, id: string): Promise<HostedArtifact> {
    const storage = this.requiredStorage()
    const row = await hostedArtifactRow(scope, id)
    if (row.status === 'awaiting_check') return hostedArtifactView(row)
    if (row.status !== 'receiving') throw notReceiving()
    const existing = await storageCall(() => storage.head(row.objectKey))
    if (existing) return freezeHostedArtifact(scope, id, objectVersion(row, existing))
    assertReceiving(row)
    const parts = checkedParts(
      row,
      await storageCall(() => storage.parts(row.objectKey, row.uploadId)),
    )
    if (parts.length !== row.manifest.length)
      throw new DomainError('安装包还有分片未上传，请继续上传后再完成', 409)
    const version = await storageCall(() => storage.complete(row.objectKey, row.uploadId, parts))
    const observed = await storageCall(() => storage.head(row.objectKey, version))
    if (!observed) throw new DomainError('对象尚未完成读回，请刷新后重新核对', 409)
    return freezeHostedArtifact(scope, id, objectVersion(row, observed, version))
  }

  /** 取消只终止本记录的上传；若对象已完成，保留并核对实际事实。 */
  async cancel(scope: HostedArtifactScope, id: string): Promise<HostedArtifact> {
    const storage = this.requiredStorage()
    const row = await hostedArtifactRow(scope, id)
    if (row.status === 'cancelled') return hostedArtifactView(row)
    if (row.status !== 'receiving') throw notReceiving()
    const before = await storageCall(() => storage.head(row.objectKey))
    if (before) return freezeHostedArtifact(scope, id, objectVersion(row, before))
    await storageCall(() => storage.abort(row.objectKey, row.uploadId))
    const after = await storageCall(() => storage.head(row.objectKey))
    if (after) return freezeHostedArtifact(scope, id, objectVersion(row, after))
    return retireHostedArtifact(scope, id, 'cancelled')
  }

  /** 只签已冻结版本，查看者和空间错配由上层事务拒绝。 */
  async download(scope: HostedArtifactScope, id: string): Promise<HostedArtifactLink> {
    const storage = this.requiredStorage()
    const row = await hostedArtifactRow(scope, id)
    if (row.status !== 'awaiting_check' || !row.objectVersion)
      throw new DomainError('当前安装包没有可下载的原文件', 409)
    const version = row.objectVersion
    const observed = await storageCall(() => storage.head(row.objectKey, version))
    if (!observed) throw new DomainError('原文件版本已不可用，请联系工作空间管理员', 409)
    objectVersion(row, observed, version)
    return { url: await storageCall(() => storage.download(row.objectKey, version)) }
  }

  /** 有引用保护时拒绝清理；删除成功后才释放配额。 */
  async remove(scope: HostedArtifactScope, id: string): Promise<HostedArtifact> {
    const storage = this.requiredStorage()
    const row = await hostedArtifactRow(scope, id)
    if (row.status === 'removed') return hostedArtifactView(row)
    if (row.status !== 'awaiting_check' || !row.objectVersion)
      throw new DomainError('只有已接收的原文件可清理', 409)
    if (await artifactHasHold(scope, id)) throw new DomainError('安装包有活动引用，暂不能清理', 409)
    const version = row.objectVersion
    await storageCall(() => storage.remove(row.objectKey, version))
    if (await storageCall(() => storage.head(row.objectKey, version)))
      throw new DomainError('原文件版本仍存在，暂未释放空间配额', 409)
    return retireHostedArtifact(scope, id, 'removed')
  }

  private requiredStorage(): HostedArtifactStorage {
    if (!this.storage) throw new DomainError('尚未配置在线安装包存储', 503)
    return this.storage
  }
}

function intakeInput(body: unknown): HostedIntakeInput {
  const data = exactFields(body, ['requestId', 'fileName', 'sizeBytes', 'manifest'])
  if (typeof data.requestId !== 'string') throw new DomainError('缺少上传请求标识')
  const requestId = hostedId(data.requestId)
  const { fileName, sizeBytes, manifest } = data
  if (
    typeof fileName !== 'string' ||
    fileName.length > 160 ||
    !/\.apk$/i.test(fileName) ||
    /[\\/\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(fileName)
  )
    throw new DomainError('请选择有效的 APK 文件名')
  if (
    typeof sizeBytes !== 'number' ||
    !Number.isInteger(sizeBytes) ||
    sizeBytes < 1 ||
    sizeBytes > limits.maxBytes
  )
    throw new DomainError('安装包必须大于 0 字节且不超过 256 MiB')
  if (
    !Array.isArray(manifest) ||
    manifest.length !== Math.ceil(sizeBytes / limits.partBytes) ||
    !manifest.every(isPartHash)
  )
    throw new DomainError('安装包分片摘要清单不正确')
  return { requestId, fileName, sizeBytes, manifest }
}

function isPartHash(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9+/]{43}=$/.test(value) &&
    Buffer.from(value, 'base64').toString('base64') === value
  )
}

function assertSameManifest(expected: string[], actual: unknown) {
  if (
    !Array.isArray(actual) ||
    expected.length !== actual.length ||
    expected.some((part, index) => part !== actual[index])
  )
    throw new DomainError('所选文件与原上传内容不同，请重新选择原安装包', 409)
}

function assertReceiving(row: HostedArtifactRow) {
  if (row.status !== 'receiving') throw notReceiving()
  if (row.secondsLeft < 1) throw new DomainError('上传已过期，请新建上传', 409)
}

function notReceiving() {
  return new DomainError('安装包已不在接收中，请刷新记录', 409)
}

function checkedParts(row: HostedArtifactRow, parts: HostedStoredPart[]): HostedStoredPart[] {
  const seen = new Set<number>()
  for (const part of parts) {
    if (
      seen.has(part.number) ||
      !Number.isInteger(part.number) ||
      part.number < 1 ||
      part.number > row.manifest.length ||
      part.checksum !== row.manifest[part.number - 1] ||
      part.bytes !== hostedPartBytes(row.sizeBytes, part.number)
    )
      throw new DomainError('对象存储分片与接收清单不符，请取消并重新上传', 409)
    seen.add(part.number)
  }
  return [...parts].sort((a, b) => a.number - b.number)
}

function objectVersion(row: HostedArtifactRow, object: HostedObject, version?: string): string {
  if (
    !object.version ||
    object.version === 'null' ||
    (version && version !== object.version) ||
    object.bytes !== row.sizeBytes ||
    object.marker !== row.id
  )
    throw new DomainError('对象版本、大小或接收标记不匹配，安装包未完成接收', 409)
  return object.version
}
