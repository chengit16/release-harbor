/** @description 单进程发布计划存储；同队列保护不可变快照、幂等请求和确认／取消，损坏时拒绝覆盖。 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { hasExactKeys, isRecord, isReleasePlan, type ReleasePlan } from '@release-harbor/contracts'
import { DomainError, planFingerprintsMatch } from '@release-harbor/domain'

/** 仅服务端用例可写入，查询带完整归属；不提供执行或自动恢复任务。 */
export class FileReleasePlanStore {
  private pending: Promise<unknown> = Promise.resolve()
  constructor(private readonly file: string) {}

  private async read(): Promise<ReleasePlan[]> {
    try {
      const value: unknown = JSON.parse(await readFile(this.file, 'utf8'))
      if (
        !isRecord(value) ||
        !hasExactKeys(value, ['schemaVersion', 'plans']) ||
        value.schemaVersion !== 1 ||
        !Array.isArray(value.plans) ||
        !value.plans.every(isReleasePlan) ||
        !value.plans.every(planFingerprintsMatch) ||
        new Set(value.plans.map((p) => p.id)).size !== value.plans.length ||
        new Set(value.plans.map((p) => p.requestId)).size !== value.plans.length
      )
        throw new Error('无效计划记录')
      return value.plans
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
      throw new DomainError('发布计划无法读取，请检查存储或从备份恢复', 503)
    }
  }

  /** 用例校验也在队列内，避免同时确认生成多个授权；不声称跨文件事务。 */
  private change<T>(operation: (plans: ReleasePlan[]) => Promise<T>): Promise<T> {
    const result = this.pending.then(async () => {
      // 1. 损坏状态不能降级为空文件，先完整重验已有快照与指纹。
      const plans = await this.read()
      const output = await operation(plans)
      if (!plans.every(isReleasePlan) || !plans.every(planFingerprintsMatch))
        throw new Error('无效计划变更')
      // 2. 快照、状态与授权同文件替换，失败保留旧文件，重启不重放副作用。
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 })
      const temporary = this.file + '.' + randomUUID() + '.tmp'
      try {
        await writeFile(temporary, JSON.stringify({ schemaVersion: 1, plans }, null, 2), {
          mode: 0o600,
          flag: 'wx',
        })
        await rename(temporary, this.file)
      } finally {
        await rm(temporary, { force: true })
      }
      return output
    })
    // 仅恢复后续队列，本次失败仍返回调用方。
    this.pending = result.catch(() => undefined)
    return result
  }

  /** 完整父级匹配后才返回，裸计划 ID 不能跨空间读取。 */
  async list(
    workspaceId: string,
    projectId: string,
    applicationId: string,
  ): Promise<ReleasePlan[]> {
    await this.pending
    return (await this.read())
      .filter((p) => {
        const a = p.snapshot.application
        return a.workspaceId === workspaceId && a.projectId === projectId && a.id === applicationId
      })
      .reverse()
  }

  /** 请求 ID 全局去重，内容比对交由用例；已存在时不触发新的预检或冻结。 */
  create(
    requestId: string,
    build: (previous: ReleasePlan | undefined) => Promise<ReleasePlan>,
  ): Promise<ReleasePlan> {
    return this.change(async (plans) => {
      const previous = plans.find((p) => p.requestId === requestId)
      const result = await build(previous)
      if (!previous) plans.push(result)
      return result
    })
  }

  /** 状态只能 frozen→confirmed／cancelled 或 confirmed→cancelled，快照不可改。 */
  update(
    workspaceId: string,
    projectId: string,
    applicationId: string,
    id: string,
    decide: (plan: ReleasePlan) => Promise<ReleasePlan>,
  ): Promise<ReleasePlan> {
    return this.change(async (plans) => {
      const index = plans.findIndex(
        (p) =>
          p.id === id &&
          p.snapshot.application.workspaceId === workspaceId &&
          p.snapshot.application.projectId === projectId &&
          p.snapshot.application.id === applicationId,
      )
      const previous = plans[index]
      if (!previous) throw new DomainError('发布计划不存在', 404)
      const result = await decide(structuredClone(previous))
      if (
        result.id !== previous.id ||
        result.requestId !== previous.requestId ||
        result.digest !== previous.digest ||
        result.createdAt !== previous.createdAt ||
        JSON.stringify(result.snapshot) !== JSON.stringify(previous.snapshot) ||
        (previous.status === 'cancelled' && JSON.stringify(previous) !== JSON.stringify(result)) ||
        (previous.authorization !== null &&
          JSON.stringify(previous.authorization) !== JSON.stringify(result.authorization)) ||
        (previous.status === 'confirmed' && result.status === 'frozen')
      )
        throw new Error('禁止覆盖计划或原确认')
      plans[index] = result
      return result
    })
  }
}
