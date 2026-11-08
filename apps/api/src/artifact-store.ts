/** @description 受控本机产物存储，UUID 目录与公开记录分离，损坏数据拒绝覆盖。 */
import { randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  statfs,
  writeFile,
} from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  artifactLimits,
  isArtifactRecord,
  isRecord,
  type ArtifactRecord,
} from '@release-harbor/contracts'
import { DomainError, validateArtifactInput } from '@release-harbor/domain'

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/

function validRecord(value: unknown): value is ArtifactRecord {
  if (
    !isArtifactRecord(value) ||
    Object.keys(value).length !== 14 ||
    !uuid.test(value.id) ||
    ['createdAt', 'updatedAt'].some((key) => {
      const input = key === 'createdAt' ? value.createdAt : value.updatedAt
      const date = new Date(input)
      return !Number.isFinite(date.getTime()) || date.toISOString() !== input
    })
  )
    return false
  try {
    const input = validateArtifactInput(
      { platform: value.format === 'apk' ? 'android' : value.format === 'app' ? 'harmony' : 'ios' },
      value.fileName,
      value.expectedSizeBytes,
    )
    return (
      input.format === value.format &&
      value.sizeBytes <= value.expectedSizeBytes &&
      (!value.identity ||
        (Object.keys(value.identity).length === 6 &&
          Object.keys(value.identity).every((key) =>
            ['format', 'packageName', 'versionName', 'buildNumber', 'sizeBytes', 'sha256'].includes(
              key,
            ),
          )))
    )
  } catch {
    return false
  }
}

/** 单进程共享实例；所有内部文件名由固定规则生成，不接受公开路径。 */
export class FileArtifactStore {
  private pending: Promise<unknown> = Promise.resolve()
  private root: string
  constructor(root: string) {
    this.root = resolve(root)
  }

  /** 启动时清理未完成字节并记录中断；不重跑检查，不改写未知版本。 */
  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    this.root = await realpath(this.root)
    const records = await this.scan()
    for (const record of records) {
      if (record.status === 'receiving' || record.status === 'checking') {
        await this.clearBytes(record)
        await this.update({
          ...record,
          status: 'failed',
          failureCode: 'interrupted',
          updatedAt: new Date().toISOString(),
        })
      } else if (record.status === 'failed') {
        await this.clearBytes(record)
      } else {
        const stat = await lstat(this.paths(record).payload).catch(() => null)
        if (!stat?.isFile() || stat.isSymbolicLink() || stat.size !== record.sizeBytes) {
          await this.clearBytes(record)
          await this.update({
            ...record,
            status: 'failed',
            failureCode: 'storage_missing',
            updatedAt: new Date().toISOString(),
          })
        }
      }
    }
  }

  /** 仅供服务内部交接执行器；返回路径不能进入 HTTP 响应。 */
  paths(record: Pick<ArtifactRecord, 'id' | 'format'>): {
    directory: string
    partial: string
    payload: string
  } {
    if (!uuid.test(record.id)) throw new DomainError('产物不存在', 404)
    const directory = join(this.root, record.id)
    return {
      directory,
      partial: join(directory, 'payload.part'),
      payload: join(directory, `payload.${record.format}`),
    }
  }

  /** 执行器只取得规范化存储根，路径仍由 UUID 与固定名称派生。 */
  storageRoot(): string {
    return this.root
  }

  private async read(id: string): Promise<ArtifactRecord> {
    const directory = this.paths({ id, format: 'apk' }).directory
    const path = join(directory, 'record.json')
    try {
      const [dir, stat] = await Promise.all([lstat(directory), lstat(path)])
      if (
        !dir.isDirectory() ||
        dir.isSymbolicLink() ||
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size > 16384
      )
        throw new Error('invalid record file')
      const data: unknown = JSON.parse(await readFile(path, 'utf8'))
      if (
        !isRecord(data) ||
        Object.keys(data).length !== 2 ||
        data.schemaVersion !== 1 ||
        !validRecord(data.artifact) ||
        data.artifact.id !== id
      )
        throw new Error('invalid record')
      return data.artifact
    } catch {
      throw new DomainError('产物记录无法读取，请检查数据或从备份恢复', 500)
    }
  }

  private async scan(): Promise<ArtifactRecord[]> {
    const records: ArtifactRecord[] = []
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!uuid.test(entry.name)) throw new DomainError('产物目录包含未知数据，请人工检查', 500)
      // 分配目录后、元数据落盘前的进程中断，只能清理完全空的自有目录。
      const directory = join(this.root, entry.name)
      if (entry.isDirectory()) {
        const files = await readdir(directory)
        if (files.every((name) => /^\.record-[a-f0-9-]{36}\.tmp$/.test(name))) {
          await rm(directory, { recursive: true })
          continue
        }
      }
      records.push(await this.read(entry.name))
    }
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  /** 读取历史检查事实；未来执行仍需重新核对实际字节。 */
  async list(
    workspaceId: string,
    projectId: string,
    applicationId: string,
  ): Promise<ArtifactRecord[]> {
    await this.pending
    return (await this.scan()).filter(
      (record) =>
        record.workspaceId === workspaceId &&
        record.projectId === projectId &&
        record.applicationId === applicationId,
    )
  }

  /** 在新增文件前检查整个受控目录预算及可用空间，不删除既有成功产物腾空间。 */
  async assertCapacity(size: number): Promise<void> {
    await this.pending
    const used = (await this.scan()).reduce(
      (total, item) =>
        total + (item.status === 'failed' ? 0 : Math.max(item.sizeBytes, item.expectedSizeBytes)),
      0,
    )
    if (used + size > artifactLimits.storageBudgetBytes)
      throw new DomainError('产物存储已达到 2 GiB 预算，请到本机设置的存储管理清理旧安装包', 507)
    const disk = await statfs(this.root)
    if (disk.bavail * disk.bsize < size + artifactLimits.diskReserveBytes)
      throw new DomainError('磁盘可用空间不足，已拒绝接收', 507)
  }

  private serialize(change: () => Promise<void>): Promise<void> {
    const operation = this.pending.then(change)
    // 只恢复后续队列，本次 operation 的失败仍返回调用方，不伪装成写入成功。
    this.pending = operation.catch(() => undefined)
    return operation
  }

  private async write(record: ArtifactRecord): Promise<void> {
    if (!validRecord(record)) throw new DomainError('产物记录状态无效', 500)
    const directory = this.paths(record).directory
    const temporary = join(directory, `.record-${randomUUID()}.tmp`)
    try {
      await writeFile(temporary, JSON.stringify({ schemaVersion: 1, artifact: record }, null, 2), {
        mode: 0o600,
        flag: 'wx',
      })
      await rename(temporary, join(directory, 'record.json'))
    } finally {
      await rm(temporary, { force: true })
    }
  }

  /** 先持久化 receiving，之后才可接收字节，异常只删除本次新分配目录。 */
  create(record: ArtifactRecord): Promise<void> {
    return this.serialize(async () => {
      const directory = this.paths(record).directory
      await mkdir(directory, { mode: 0o700 })
      try {
        await this.write(record)
      } catch (error) {
        await rm(directory, { recursive: true, force: true })
        throw error
      }
    })
  }

  /** 同一记录归属不可变化，已失败记录不会被静默激活。 */
  update(record: ArtifactRecord): Promise<void> {
    return this.serialize(async () => {
      const current = await this.read(record.id)
      for (const key of [
        'workspaceId',
        'projectId',
        'applicationId',
        'fileName',
        'format',
        'expectedSizeBytes',
        'createdAt',
      ] as const)
        if (record[key] !== current[key]) throw new DomainError('产物归属或原始资料不可修改', 500)
      const allowed =
        current.status === 'receiving'
          ? ['checking', 'failed']
          : current.status === 'checking'
            ? ['ready', 'failed']
            : current.status === 'ready'
              ? ['failed']
              : []
      if (!allowed.includes(record.status)) throw new DomainError('产物状态转换无效', 500)
      await this.write(record)
    })
  }

  /** 仅供维护门禁使用；先保存清理事实，崩溃后 initialize 继续回收字节。 */
  async removePayload(record: ArtifactRecord): Promise<void> {
    await this.serialize(async () => {
      const current = await this.read(record.id)
      if (current.status === 'receiving' || current.status === 'checking')
        throw new DomainError('安装包仍在接收或检查中', 409)
      if (current.status !== 'failed' || current.failureCode !== 'removed')
        await this.write({
          ...current,
          status: 'failed',
          failureCode: 'removed',
          updatedAt: new Date().toISOString(),
        })
      await this.clearBytes(current)
    })
  }

  /** 删除本条自有字节，失败记录仍保留；不按用户文件名查找路径。 */
  async clearBytes(record: ArtifactRecord): Promise<void> {
    const { payload, partial } = this.paths(record)
    await rm(partial, { force: true })
    await rm(payload, { force: true })
  }
}
