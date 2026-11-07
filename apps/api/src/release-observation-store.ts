/** @description 独立的只读状态观察档案；单进程串行预约与追加，不改写发布计划、授权或原回执。 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { DomainError } from '@release-harbor/domain'
import {
  isRecord,
  hasExactKeys,
  isReleaseObservation,
  type ReleaseObservation,
} from '@release-harbor/contracts'

/** 查询预约在请求前持久化，崩溃不会绕过产品防重复策略；只保存公开身份，不保存账号引用。 */
interface Entry {
  workspaceId: string
  target: string
  requestedAt: string
  observation: ReleaseObservation | null
}
/** 仅本机单实例使用；损坏明确失败，未完成预约只保留查询占用，不重跑。 */
export class ReleaseObservationStore {
  private pending: Promise<unknown> = Promise.resolve()
  constructor(private readonly file: string) {}
  /** 仅供维护门禁内校验快照，读取不执行迁移或外部请求。 */
  async backupState() {
    await this.pending
    return this.read()
  }

  private async read(): Promise<Entry[]> {
    try {
      const value: unknown = JSON.parse(await readFile(this.file, 'utf8'))
      if (
        !isRecord(value) ||
        !hasExactKeys(value, ['schemaVersion', 'entries']) ||
        value.schemaVersion !== 1 ||
        !Array.isArray(value.entries) ||
        !value.entries.every(
          (e): e is Entry =>
            isRecord(e) &&
            hasExactKeys(e, ['workspaceId', 'target', 'requestedAt', 'observation']) &&
            typeof e.workspaceId === 'string' &&
            typeof e.target === 'string' &&
            /^(honor|meizu):\d{1,30}$/.test(e.target) &&
            typeof e.requestedAt === 'string' &&
            Number.isFinite(Date.parse(e.requestedAt)) &&
            new Date(e.requestedAt).toISOString() === e.requestedAt &&
            (e.observation === null ||
              (isReleaseObservation(e.observation) &&
                e.observation.requestedAt === e.requestedAt &&
                e.target.startsWith(e.observation.channel + ':'))),
        )
      )
        throw Error()
      const ids = value.entries.map((e) => `${e.workspaceId}:${e.target}:${e.requestedAt}`)
      if (new Set(ids).size !== ids.length) throw Error()
      return value.entries
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
      throw new DomainError('商店状态观察记录无法读取，请检查本机存储', 500)
    }
  }
  private change<T>(operation: (entries: Entry[]) => T): Promise<T> {
    const task = this.pending.then(async () => {
      // 1. 同进程队列内完整读取，损坏时不得降级为空档案。
      const entries = await this.read()
      // 2. 预约或追加先校验业务约束，拒绝时不替换原文件。
      const result = operation(entries)
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 })
      // 3. 同目录原子替换，失败清理临时字节并保留本次错误。
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
    // 当前调用仍收到失败，后续查询可以继续进入串行队列。
    this.pending = task.catch(() => undefined)
    return task
  }
  /** 同一目标共用保守查询窗口；完成失败后可缩短到一分钟，重启未完成预约保留三小时。 */
  reserve(workspaceId: string, target: string, requestedAt: string): Promise<void> {
    return this.change((entries) => {
      const latest = entries
        .filter((e) => e.workspaceId === workspaceId && e.target === target)
        .at(-1)
      const next = latest
        ? Date.parse(latest.observation?.nextQueryAt ?? '') ||
          Date.parse(latest.requestedAt) + 10800000
        : 0
      if (Date.parse(requestedAt) < next)
        throw new DomainError(`该商店目标下次可查询时间：${new Date(next).toISOString()}`, 429)
      entries.push({ workspaceId, target, requestedAt, observation: null })
    })
  }
  /** 只完成对应预约；失败记录同样追加，原有成功观察不被覆盖。 */
  finish(workspaceId: string, target: string, observation: ReleaseObservation): Promise<void> {
    return this.change((entries) => {
      const entry = entries.find(
        (e) =>
          e.workspaceId === workspaceId &&
          e.target === target &&
          e.requestedAt === observation.requestedAt &&
          e.observation === null,
      )
      if (
        !entry ||
        !isReleaseObservation(observation) ||
        !target.startsWith(observation.channel + ':')
      )
        throw new DomainError('商店状态查询关联无效', 500)
      entry.observation = observation
    })
  }
  /** 仅读取当前应用的已完成查询；未完成预约只保留频率限制，不伪造远端结果。 */
  async list(
    workspaceId: string,
    projectId: string,
    applicationId: string,
  ): Promise<ReleaseObservation[]> {
    await this.pending
    return (await this.read())
      .filter((e) => e.workspaceId === workspaceId)
      .flatMap((e) =>
        e.observation?.projectId === projectId && e.observation.applicationId === applicationId
          ? [e.observation]
          : [],
      )
      .reverse()
  }
}
