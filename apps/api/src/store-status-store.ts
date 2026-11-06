/** @description 独立查询缓存与预约存储；单进程串行原子写入，不修改计划、授权或执行回执。 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DomainError } from '@release-harbor/domain'
import {
  hasExactKeys,
  isRecord,
  isStoreStatusSnapshot,
  type StoreStatusSnapshot,
} from '@release-harbor/contracts'

interface Entry {
  key: string
  requestedAt: number
  pending: boolean
  snapshots: StoreStatusSnapshot[]
}

/** 绑定指纹隔离缓存；保留最后成功与最近失败，损坏时拒绝覆盖。仅支持单个 API 进程。 */
export class StoreStatusStore {
  private pending: Promise<unknown> = Promise.resolve()
  constructor(private readonly file: string) {}

  private async read(): Promise<Entry[]> {
    try {
      const value: unknown = JSON.parse(await readFile(this.file, 'utf8'))
      if (
        !isRecord(value) ||
        !hasExactKeys(value, ['schemaVersion', 'entries']) ||
        value.schemaVersion !== 1 ||
        !Array.isArray(value.entries)
      )
        throw Error()
      const entries: Entry[] = []
      for (const entry of value.entries) {
        if (
          !isRecord(entry) ||
          !hasExactKeys(entry, ['key', 'requestedAt', 'pending', 'snapshots']) ||
          typeof entry.key !== 'string' ||
          !/^[a-f0-9]{64}$/.test(entry.key) ||
          typeof entry.requestedAt !== 'number' ||
          !Number.isSafeInteger(entry.requestedAt) ||
          entry.requestedAt < 0 ||
          typeof entry.pending !== 'boolean' ||
          !Array.isArray(entry.snapshots) ||
          entry.snapshots.length > 2 ||
          !entry.snapshots.every(isStoreStatusSnapshot) ||
          entries.some((item) => item.key === entry.key)
        )
          throw Error()
        entries.push({
          key: entry.key,
          requestedAt: entry.requestedAt,
          pending: entry.pending,
          snapshots: entry.snapshots,
        })
      }
      return entries
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
      throw new DomainError('商店状态查询记录无法读取，请检查本机存储', 500)
    }
  }

  private change<T>(operation: (entries: Entry[]) => T): Promise<T> {
    const task = this.pending.then(async () => {
      const entries = await this.read()
      const result = operation(entries)
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 })
      const temporary = this.file + '.' + randomUUID() + '.tmp'
      try {
        await writeFile(temporary, JSON.stringify({ schemaVersion: 1, entries }, null, 2), {
          mode: 0o600,
          flag: 'wx',
        })
        await rename(temporary, this.file)
      } finally {
        await rm(temporary, { force: true })
      }
      return result
    })
    this.pending = task.catch(() => undefined)
    return task
  }

  /** 仅返回当前可信目录的绑定指纹；配置变化后不会沿用旧目标的结果。 */
  async list(keys: string[]): Promise<StoreStatusSnapshot[]> {
    await this.pending
    const allowed = new Set(keys)
    return (await this.read())
      .filter((entry) => allowed.has(entry.key))
      .flatMap((entry) => entry.snapshots)
  }

  /** 先持久化预约再访问商店；中断后等待三分钟，避免重启或重复点击并行请求。 */
  reserve(key: string, now = Date.now()): Promise<void> {
    return this.change((entries) => {
      const entry = entries.find((item) => item.key === key)
      if (entry && now - entry.requestedAt < (entry.pending ? 180000 : 10000))
        throw new DomainError('该商店正在查询或刚完成查询，请稍后再试', 409)
      if (entry) {
        entry.requestedAt = now
        entry.pending = true
      } else entries.push({ key, requestedAt: now, pending: true, snapshots: [] })
    })
  }

  /** 失败保留上次成功及其时间，不将旧成功冒充本次结果。 */
  finish(key: string, snapshot: StoreStatusSnapshot): Promise<void> {
    return this.change((entries) => {
      const entry = entries.find((item) => item.key === key)
      if (!entry?.pending) throw new DomainError('商店查询预约不存在', 409)
      const success = entry.snapshots.find((item) => item.code === 'observed')
      entry.snapshots = [snapshot, ...(snapshot.code !== 'observed' && success ? [success] : [])]
      entry.pending = false
    })
  }
}
