/** @description 单进程发布计划存储；同队列保护不可变快照、幂等请求和确认／取消，损坏时拒绝覆盖。 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  hasExactKeys,
  isRecord,
  isReleasePlan,
  type ReleasePlan,
  isReleaseAttempt,
  isReleasePreparation,
  type ReleasePreparation,
  type ReleaseAttempt,
} from '@release-harbor/contracts'
import { DomainError, planFingerprintsMatch } from '@release-harbor/domain'

/** 计划与一次性尝试同文件提交；仅支持本地单进程，不自动重放执行。 */
export class FileReleasePlanStore {
  private pending: Promise<unknown> = Promise.resolve()
  constructor(private readonly file: string) {}

  private async read(): Promise<{
    plans: ReleasePlan[]
    attempts: ReleaseAttempt[]
    preparations: ReleasePreparation[]
  }> {
    try {
      const value: unknown = JSON.parse(await readFile(this.file, 'utf8'))
      if (
        !isRecord(value) ||
        !(
          (value.schemaVersion === 1 && hasExactKeys(value, ['schemaVersion', 'plans'])) ||
          ((value.schemaVersion === 2 || value.schemaVersion === 3) &&
            hasExactKeys(value, ['schemaVersion', 'plans', 'attempts'])) ||
          (value.schemaVersion === 4 &&
            hasExactKeys(value, ['schemaVersion', 'plans', 'attempts', 'preparations']))
        ) ||
        !Array.isArray(value.plans) ||
        !value.plans.every(isReleasePlan) ||
        !value.plans.every(planFingerprintsMatch) ||
        new Set(value.plans.map((p) => p.id)).size !== value.plans.length ||
        new Set(value.plans.map((p) => p.requestId)).size !== value.plans.length
      )
        throw new Error('无效计划记录')
      const plans = value.plans
      const attempts = value.schemaVersion === 1 ? [] : value.attempts
      if (
        !Array.isArray(attempts) ||
        !attempts.every(isReleaseAttempt) ||
        new Set(attempts.map((a) => a.id)).size !== attempts.length ||
        new Set(attempts.map((a) => a.planId)).size !== attempts.length ||
        new Set(attempts.map((a) => a.authorizationId)).size !== attempts.length ||
        attempts.filter((a) => a.finishedAt === null).length > 1 ||
        !attempts.every((a) =>
          plans.some(
            (p: ReleasePlan) =>
              p.id === a.planId &&
              p.status === 'confirmed' &&
              p.digest === a.planDigest &&
              p.authorization?.id === a.authorizationId,
          ),
        )
      )
        throw new Error('无效执行记录')
      const preparations = value.schemaVersion === 4 ? value.preparations : []
      if (
        !Array.isArray(preparations) ||
        !preparations.every(isReleasePreparation) ||
        new Set(preparations.map((p) => p.id)).size !== preparations.length ||
        preparations.filter((p) => p.status === 'checking').length > 1 ||
        !preparations.every(
          (p) =>
            p.status !== 'ready' ||
            plans.some(
              (plan) =>
                plan.id === p.planId &&
                plan.requestId === p.id &&
                plan.snapshot.preflight.id === p.preflightId &&
                plan.snapshot.application.workspaceId === p.workspaceId &&
                plan.snapshot.application.projectId === p.projectId &&
                plan.snapshot.application.id === p.applicationId &&
                plan.snapshot.binding.id === p.input.bindingId &&
                plan.snapshot.binding.revision === p.input.expectedBindingRevision &&
                plan.snapshot.artifact.id === p.input.artifactId &&
                plan.snapshot.artifact.sha256 === p.input.expectedArtifactSha256 &&
                plan.snapshot.releaseNotes === p.input.releaseNotes,
            ),
        )
      )
        throw new Error('无效准备记录')
      return { plans: value.plans, attempts, preparations }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return { plans: [], attempts: [], preparations: [] }
      throw new DomainError('发布计划无法读取，请检查存储或从备份恢复', 503)
    }
  }

  /** 用例校验也在队列内，避免同时确认生成多个授权；不声称跨文件事务。 */
  private change<T>(
    operation: (
      plans: ReleasePlan[],
      attempts: ReleaseAttempt[],
      preparations: ReleasePreparation[],
    ) => Promise<T>,
  ): Promise<T> {
    const result = this.pending.then(async () => {
      // 1. 损坏状态不能降级为空文件，先完整重验已有快照与指纹。
      const { plans, attempts, preparations } = await this.read()
      const output = await operation(plans, attempts, preparations)
      if (
        !plans.every(isReleasePlan) ||
        !plans.every(planFingerprintsMatch) ||
        !attempts.every(isReleaseAttempt) ||
        !preparations.every(isReleasePreparation)
      )
        throw new Error('无效计划变更')
      // 2. 快照、状态与授权同文件替换，失败保留旧文件，重启不重放副作用。
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 })
      const temporary = this.file + '.' + randomUUID() + '.tmp'
      try {
        await writeFile(
          temporary,
          JSON.stringify({ schemaVersion: 4, plans, attempts, preparations }, null, 2),
          {
            mode: 0o600,
            flag: 'wx',
          },
        )
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
    return (await this.read()).plans
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
    return this.change(async (plans, attempts) => {
      const index = plans.findIndex(
        (p) =>
          p.id === id &&
          p.snapshot.application.workspaceId === workspaceId &&
          p.snapshot.application.projectId === projectId &&
          p.snapshot.application.id === applicationId,
      )
      const previous = plans[index]
      if (!previous) throw new DomainError('发布计划不存在', 404)
      if (attempts.some((a) => a.planId === id))
        throw new DomainError('计划授权已消费，请查看执行记录；不能取消或重新确认', 409)
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
  /** 原子事务端口只供执行用例：消费、许可与回执必须串行，不能在回调内再次读取本 Store。 */
  execution<T>(
    decide: (
      plans: ReleasePlan[],
      attempts: ReleaseAttempt[],
      preparations: ReleasePreparation[],
    ) => Promise<T>,
  ): Promise<T> {
    return this.change(decide)
  }

  /** 安全记录按父级计划过滤，裸尝试 ID 不形成授权。 */
  async attempts(
    workspaceId: string,
    projectId: string,
    applicationId: string,
  ): Promise<ReleaseAttempt[]> {
    await this.pending
    const data = await this.read()
    const ids = new Set(
      data.plans
        .filter(
          (p) =>
            p.snapshot.application.workspaceId === workspaceId &&
            p.snapshot.application.projectId === projectId &&
            p.snapshot.application.id === applicationId,
        )
        .map((p) => p.id),
    )
    return data.attempts.filter((a) => ids.has(a.planId)).reverse()
  }
  /** 只读取完整应用范围内的准备事实，不恢复任务。 */
  async preparations(
    workspaceId: string,
    projectId: string,
    applicationId: string,
  ): Promise<ReleasePreparation[]> {
    await this.pending
    return (await this.read()).preparations
      .filter(
        (p) =>
          p.workspaceId === workspaceId &&
          p.projectId === projectId &&
          p.applicationId === applicationId,
      )
      .reverse()
  }
}
