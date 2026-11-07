/** @description 独立查询缓存、有限历史与预约存储；单进程串行原子写入，不修改计划、授权或执行回执。 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DomainError } from '@release-harbor/domain'
import {
  hasExactKeys,
  isRecord,
  isStoreStatusSnapshot,
  isStoreManualRecord,
  type StoreManualRecord,
  type StoreStatusSnapshot,
} from '@release-harbor/contracts'

interface Entry {
  key: string
  requestedAt: number
  pending: boolean
  snapshots: StoreStatusSnapshot[]
  trackedSnapshots: StoreStatusSnapshot[]
  manualRecords: StoreManualRecord[]
  queryHistory: StoreStatusSnapshot[]
}

/** 绑定指纹隔离最近缓存与三十次历史；损坏时拒绝覆盖，仅支持单个 API 进程。 */
export class StoreStatusStore {
  private pending: Promise<unknown> = Promise.resolve()
  constructor(private readonly file: string) {}

  private async read(): Promise<Entry[]> {
    try {
      const value: unknown = JSON.parse(await readFile(this.file, 'utf8'))
      if (
        !isRecord(value) ||
        !hasExactKeys(value, ['schemaVersion', 'entries']) ||
        typeof value.schemaVersion !== 'number' ||
        ![1, 2, 3].includes(value.schemaVersion) ||
        !Array.isArray(value.entries)
      )
        throw Error()
      const entries: Entry[] = []
      for (const entry of value.entries) {
        if (
          !isRecord(entry) ||
          !hasExactKeys(entry, [
            'key',
            'requestedAt',
            'pending',
            'snapshots',
            ...(value.schemaVersion >= 2 ? ['trackedSnapshots', 'manualRecords'] : []),
            ...(value.schemaVersion === 3 ? ['queryHistory'] : []),
          ]) ||
          typeof entry.key !== 'string' ||
          !/^[a-f0-9]{64}$/.test(entry.key) ||
          typeof entry.requestedAt !== 'number' ||
          !Number.isSafeInteger(entry.requestedAt) ||
          entry.requestedAt < 0 ||
          typeof entry.pending !== 'boolean' ||
          !Array.isArray(entry.snapshots) ||
          entry.snapshots.length > 2 ||
          !entry.snapshots.every(isStoreStatusSnapshot) ||
          entry.snapshots.some((snapshot) => snapshot.query) ||
          entries.some((item) => item.key === entry.key)
        )
          throw Error()
        const trackedSnapshots = value.schemaVersion === 1 ? [] : entry.trackedSnapshots
        const manualRecords = value.schemaVersion === 1 ? [] : entry.manualRecords
        // 旧缓存只有最近结果，不能伪造此前每次查询的留存历史。
        const queryHistory = value.schemaVersion === 3 ? entry.queryHistory : []
        if (
          !Array.isArray(trackedSnapshots) ||
          trackedSnapshots.length > 40 ||
          !trackedSnapshots.every(
            (snapshot) => isStoreStatusSnapshot(snapshot) && !!snapshot.query,
          ) ||
          !Array.isArray(manualRecords) ||
          manualRecords.length > 200 ||
          !manualRecords.every(isStoreManualRecord) ||
          new Set(manualRecords.map((item) => item.requestId)).size !== manualRecords.length ||
          !Array.isArray(queryHistory) ||
          queryHistory.length > 30 ||
          !queryHistory.every(isStoreStatusSnapshot)
        )
          throw Error()
        // 同一指纹下的资料必须属于同一个绑定，损坏时拒绝读取与覆盖。
        if (
          new Set(
            [...entry.snapshots, ...trackedSnapshots, ...manualRecords, ...queryHistory].map(
              (item) => item.bindingId,
            ),
          ).size > 1 ||
          new Set(
            [...entry.snapshots, ...trackedSnapshots, ...queryHistory].map((item) => item.channel),
          ).size > 1 ||
          (manualRecords.length > 0 &&
            [...entry.snapshots, ...trackedSnapshots, ...queryHistory].some(
              (item) => item.channel !== 'xiaomi',
            ))
        )
          throw Error()
        entries.push({
          key: entry.key,
          requestedAt: entry.requestedAt,
          pending: entry.pending,
          snapshots: entry.snapshots,
          trackedSnapshots,
          manualRecords,
          queryHistory,
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
        await writeFile(temporary, JSON.stringify({ schemaVersion: 3, entries }, null, 2), {
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
      .flatMap((entry) => entry.snapshots.filter((snapshot) => !snapshot.query))
  }

  /** 同一次只读快照按完整绑定指纹筛选，改绑后不沿用旧查询或人工记录。 */
  async tracking(keys: string[]): Promise<{
    snapshots: StoreStatusSnapshot[]
    trackedSnapshots: StoreStatusSnapshot[]
    manualRecords: StoreManualRecord[]
    queryHistory: StoreStatusSnapshot[]
  }> {
    await this.pending
    const entries = (await this.read()).filter((entry) => keys.includes(entry.key))
    return {
      snapshots: entries.flatMap((entry) => entry.snapshots),
      trackedSnapshots: entries.flatMap((entry) => entry.trackedSnapshots),
      manualRecords: entries.flatMap((entry) => entry.manualRecords),
      queryHistory: entries.flatMap((entry) => entry.queryHistory),
    }
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
      } else
        entries.push({
          key,
          requestedAt: now,
          pending: true,
          snapshots: [],
          trackedSnapshots: [],
          manualRecords: [],
          queryHistory: [],
        })
    })
  }

  /** 最近缓存和有限历史同次落盘；失败保留上次成功及其时间，不将旧成功冒充本次结果。 */
  finish(key: string, snapshot: StoreStatusSnapshot): Promise<void> {
    return this.change((entries) => {
      const entry = entries.find((item) => item.key === key)
      if (!entry?.pending) throw new DomainError('商店查询预约不存在', 409)
      if (!isStoreStatusSnapshot(snapshot)) throw new DomainError('查询结果不合法', 400)
      const identity =
        entry.snapshots[0] ??
        entry.trackedSnapshots[0] ??
        entry.manualRecords[0] ??
        entry.queryHistory[0]
      if (
        identity &&
        (identity.bindingId !== snapshot.bindingId ||
          ('channel' in identity && identity.channel !== snapshot.channel))
      )
        throw new DomainError('查询结果不属于当前缓存目标', 409)
      const previous = snapshot.query
        ? entry.trackedSnapshots.filter(
            (item) => item.query?.buildNumber === snapshot.query?.buildNumber,
          )
        : entry.snapshots
      const success = previous.find((item) => item.code === 'observed')
      const next = [snapshot, ...(snapshot.code !== 'observed' && success ? [success] : [])]
      if (snapshot.query) {
        const other = entry.trackedSnapshots.filter(
          (item) => item.query?.buildNumber !== snapshot.query?.buildNumber,
        )
        // 指定构建是有界缓存，最近二十个构建各保留最近失败与上次成功。
        const builds = [
          ...new Set([snapshot.query.buildNumber, ...other.map((item) => item.query?.buildNumber)]),
        ].slice(0, 20)
        entry.trackedSnapshots = [
          ...next,
          ...other.filter((item) => builds.includes(item.query?.buildNumber)),
        ]
      } else entry.snapshots = next
      // 每次完成均保留，包括失败及状态未变化；默认与指定构建共用三十次总预算。
      entry.queryHistory = [snapshot, ...entry.queryHistory].slice(0, 30)
      entry.pending = false
    })
  }

  /** 人工核对仅追加本机事实；同 requestId 重试幂等，不接触发布存储。 */
  saveManual(key: string, record: StoreManualRecord): Promise<StoreManualRecord> {
    return this.change((entries) => {
      if (!isStoreManualRecord(record)) throw new DomainError('人工核对资料不合法')
      let entry = entries.find((item) => item.key === key)
      if (!entry) {
        entry = {
          key,
          requestedAt: 0,
          pending: false,
          snapshots: [],
          trackedSnapshots: [],
          manualRecords: [],
          queryHistory: [],
        }
        entries.push(entry)
      }
      const identity =
        entry.snapshots[0] ??
        entry.trackedSnapshots[0] ??
        entry.manualRecords[0] ??
        entry.queryHistory[0]
      if (
        identity &&
        (identity.bindingId !== record.bindingId ||
          ('channel' in identity && identity.channel !== 'xiaomi'))
      )
        throw new DomainError('人工记录不属于当前缓存目标', 409)
      const existing = entry.manualRecords.find((item) => item.requestId === record.requestId)
      if (existing) {
        if (
          (
            [
              'versionName',
              'buildNumber',
              'state',
              'checkedAt',
              'note',
              'bindingId',
              'source',
            ] as const
          ).some((field) => existing[field] !== record[field])
        )
          throw new DomainError('该保存请求已使用，请重新核对后保存', 409)
        return existing
      }
      if (entry.manualRecords.length >= 200)
        throw new DomainError('人工核对历史已达本机上限，请先备份并联系维护者整理', 409)
      entry.manualRecords.unshift(record)
      return record
    })
  }
}
