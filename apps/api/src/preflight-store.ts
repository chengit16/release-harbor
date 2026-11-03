/** @description 本地单进程预检事实存储，串行原子替换；损坏时拒绝覆盖，重启不重跑。 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { isPreflightRecord, isRecord, type PreflightRecord } from '@release-harbor/contracts'
import { DomainError } from '@release-harbor/domain'

/** 只能从 running 转为末态，末态事实禁止修改。 */
export class FilePreflightStore {
  private pending: Promise<unknown> = Promise.resolve()
  constructor(private readonly file: string) {}

  private async read(): Promise<PreflightRecord[]> {
    try {
      const value: unknown = JSON.parse(await readFile(this.file, 'utf8'))
      if (
        !isRecord(value) ||
        Object.keys(value).length !== 2 ||
        value.schemaVersion !== 1 ||
        !Array.isArray(value.records) ||
        !value.records.every(isPreflightRecord) ||
        new Set(value.records.map((r) => r.id)).size !== value.records.length
      )
        throw new Error('无效记录')
      return value.records
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
      throw new DomainError('预检记录无法读取，请检查存储或从备份恢复', 503)
    }
  }

  private write(records: PreflightRecord[]): Promise<void> {
    return (async () => {
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 })
      const temporary = this.file + '.' + randomUUID() + '.tmp'
      try {
        await writeFile(temporary, JSON.stringify({ schemaVersion: 1, records }, null, 2), {
          mode: 0o600,
          flag: 'wx',
        })
        await rename(temporary, this.file)
      } finally {
        await rm(temporary, { force: true })
      }
    })()
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.pending.then(operation)
    this.pending = result.catch(() => undefined)
    return result
  }

  /** 启动中断是无法验证，不能恢复成通过或偷偷再请求商店。 */
  initialize(): Promise<void> {
    return this.enqueue(async () => {
      const records = await this.read()
      const now = new Date().toISOString()
      if (records.some((r) => r.status === 'running'))
        await this.write(
          records.map((r) =>
            r.status === 'running'
              ? { ...r, status: 'unverified', code: 'interrupted', checkedAt: now, expiresAt: now }
              : r,
          ),
        )
    })
  }

  /** 必须带完整父级范围查询，不能仅按裸 ID 读取。 */
  async list(
    workspaceId: string,
    projectId: string,
    applicationId: string,
  ): Promise<PreflightRecord[]> {
    await this.pending
    return (await this.read())
      .filter(
        (r) =>
          r.workspaceId === workspaceId &&
          r.projectId === projectId &&
          r.applicationId === applicationId,
      )
      .reverse()
  }

  /** 创建和结束都使用同一写队列保护，不接受覆盖旧的最终结论。 */
  save(record: PreflightRecord): Promise<void> {
    return this.enqueue(async () => {
      if (!isPreflightRecord(record)) throw new Error('无效预检记录')
      const records = await this.read()
      const previous = records.find((r) => r.id === record.id)
      if (previous) {
        if (
          previous.status !== 'running' ||
          record.status === 'running' ||
          [
            'workspaceId',
            'projectId',
            'applicationId',
            'bindingId',
            'bindingRevision',
            'artifactId',
            'artifactSha256',
            'credentialReference',
            'profileRevision',
            'createdAt',
          ].some((k) => Reflect.get(previous, k) !== Reflect.get(record, k))
        )
          throw new Error('预检事实不可覆盖')
      } else if (record.status !== 'running') throw new Error('须先登记预检')
      await this.write(
        previous ? records.map((r) => (r.id === record.id ? record : r)) : [...records, record],
      )
    })
  }
}
