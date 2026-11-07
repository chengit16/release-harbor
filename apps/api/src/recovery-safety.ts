/** @description 恢复范围之外的发布保护账本；写许可前先落盘，恢复旧业务数据不回退远端事实。 */
import { planFingerprintsMatch, planFingerprint, DomainError } from '@release-harbor/domain'
import {
  isRecord,
  hasExactKeys,
  isPlanId,
  type RecoveryProtection,
  isReleasePlan,
  isReleaseAttempt,
  isAppleReviewRecord,
  type ReleasePlan,
  type ReleaseAttempt,
  type AppleReviewRecord,
} from '@release-harbor/contracts'
import { atomicLocal, readLocal } from './local-files.ts'
import { attemptBlocksTarget } from './release-reconciliation.ts'

/** 账本只保留安全快照和事实；不保存商店材料，不能从浏览器覆盖。 */
interface Ledger {
  schemaVersion: 1
  plans: ReleasePlan[]
  attempts: ReleaseAttempt[]
  appleReviews: AppleReviewRecord[]
  retired: string[]
  restoredAt: string | null
  readOnly: boolean
}
/** 保护账本先校验快照自带指纹，再核对计划 ID 唯一性。 */
function isPlanList(value: unknown): value is ReleasePlan[] {
  return (
    Array.isArray(value) &&
    value.every(isReleasePlan) &&
    value.every(planFingerprintsMatch) &&
    new Set(value.map((p) => p.id)).size === value.length
  )
}
/** 回执必须唯一关联账本中的原计划及摘要，否则不能参与恢复后的防重判断。 */
function attemptsMatchPlans(attempts: unknown, plans: unknown): attempts is ReleaseAttempt[] {
  return (
    Array.isArray(attempts) &&
    Array.isArray(plans) &&
    attempts.every(isReleaseAttempt) &&
    new Set(attempts.map((a) => a.id)).size === attempts.length &&
    new Set(attempts.map((a) => a.planId)).size === attempts.length &&
    attempts.every((a) =>
      plans.some((p) => isReleasePlan(p) && p.id === a.planId && p.digest === a.planDigest),
    )
  )
}
/** 同计划存储队列调用；先保存保守事实后才允许派发商店写入。 */
export class RecoverySafety {
  private pending: Promise<unknown> = Promise.resolve()
  constructor(private readonly file: string) {}
  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const task = this.pending.then(action)
    this.pending = task.catch(() => undefined)
    return task
  }
  private async read(): Promise<Ledger> {
    const raw = await readLocal(this.file)
    if (raw === null) throw new DomainError('发布保护账本缺失，请保持只读并核对商店', 503)
    const v: unknown = JSON.parse(raw)
    if (
      !isRecord(v) ||
      !(
        hasExactKeys(v, [
          'schemaVersion',
          'plans',
          'attempts',
          'appleReviews',
          'retired',
          'readOnly',
        ]) ||
        hasExactKeys(v, [
          'schemaVersion',
          'plans',
          'attempts',
          'appleReviews',
          'retired',
          'restoredAt',
          'readOnly',
        ])
      ) ||
      v.schemaVersion !== 1 ||
      !isPlanList(v.plans) ||
      !attemptsMatchPlans(v.attempts, v.plans) ||
      !Array.isArray(v.appleReviews) ||
      !v.appleReviews.every(isAppleReviewRecord) ||
      !v.appleReviews.every((r) => r.digest === planFingerprint(r.snapshot)) ||
      new Set(v.appleReviews.map((r) => r.id)).size !== v.appleReviews.length ||
      !Array.isArray(v.retired) ||
      !v.retired.every(isPlanId) ||
      typeof v.readOnly !== 'boolean' ||
      !(
        !Object.hasOwn(v, 'restoredAt') ||
        v.restoredAt === null ||
        (typeof v.restoredAt === 'string' && Number.isFinite(Date.parse(v.restoredAt)))
      )
    )
      throw new DomainError('发布保护账本损坏，请保持只读并核对商店', 503)
    return {
      schemaVersion: 1,
      plans: v.plans,
      attempts: v.attempts,
      appleReviews: v.appleReviews,
      retired: v.retired,
      readOnly: v.readOnly,
      restoredAt: typeof v.restoredAt === 'string' ? v.restoredAt : null,
    }
  }
  /** 跨安装恢复不自动解除只读；首版保留历史导入，迁移发布资格另行核对。 */
  async isReadOnly(): Promise<boolean> {
    await this.pending
    return (await this.read()).readOnly
  }
  /** 恢复前注销全部旧快照，保留备份之后的保护事实；中断也不能复活旧许可。 */
  retire(plans: ReleasePlan[], apple: AppleReviewRecord[], foreign: boolean): Promise<void> {
    return this.enqueue(() => this.retireNow(plans, apple, foreign))
  }
  private async retireNow(
    plans: ReleasePlan[],
    apple: AppleReviewRecord[],
    foreign: boolean,
  ): Promise<void> {
    const ledger = await this.read()
    ledger.retired = [
      ...new Set([...ledger.retired, ...plans.map((x) => x.id), ...apple.map((x) => x.id)]),
    ]
    ledger.readOnly ||= foreign
    ledger.restoredAt = new Date().toISOString()
    await atomicLocal(this.file, ledger)
  }
  /** 查看恢复范围之外的事实，历史事实不能因恢复旧文件而消失。 */
  async protections(): Promise<RecoveryProtection[]> {
    await this.pending
    const l = await this.read(),
      items: RecoveryProtection[] = []
    for (const a of l.attempts) {
      const p = l.plans.find((p) => p.id === a.planId)
      if (!p || !a.remoteStartedAt || !l.retired.includes(a.planId)) continue
      items.push({
        id: a.id,
        kind: 'attempt',
        digest: p.digest,
        applicationName: p.snapshot.application.name,
        channel: p.snapshot.binding.channel,
        appId: p.snapshot.binding.appId,
        versionName: p.snapshot.artifact.identity?.versionName ?? '',
        buildNumber: p.snapshot.artifact.identity?.buildNumber ?? '',
        unknown:
          a.status === 'needs_reconciliation' || (!a.finishedAt && l.retired.includes(a.planId)),
        decision: a.reconciliation
          ? ['no_draft', 'not_submitted', 'no_build'].includes(a.reconciliation.decision)
            ? 'absent'
            : 'present'
          : a.status === 'succeeded'
            ? 'present'
            : null,
      })
    }
    for (const r of l.appleReviews) {
      if (!r.remoteStartedAt || !l.retired.includes(r.id)) continue
      items.push({
        id: r.id,
        kind: 'apple',
        digest: r.digest,
        applicationName: r.snapshot.identifier,
        channel: 'app_store',
        appId: r.snapshot.binding.appId,
        versionName: r.snapshot.version.version,
        buildNumber: r.snapshot.build.number,
        unknown: r.status === 'unknown' || (r.status === 'running' && l.retired.includes(r.id)),
        decision: r.reconciliation?.decision ?? (r.status === 'succeeded' ? 'present' : null),
      })
    }
    return items
  }
  /** 仅为恢复前未知事实追加人工声明，严格绑定原摘要和版本，不解除其他保护。 */
  reconcile(body: unknown): Promise<void> {
    return this.enqueue(async () => {
      if (
        !isRecord(body) ||
        !hasExactKeys(body, [
          'id',
          'kind',
          'digest',
          'versionName',
          'buildNumber',
          'decision',
          'acknowledged',
        ]) ||
        body.acknowledged !== true ||
        !['present', 'absent'].includes(String(body.decision))
      )
        throw new DomainError('请核对商店目标及版本并明确确认', 400)
      const l = await this.read(),
        checkedAt = new Date().toISOString()
      if (body.kind === 'attempt') {
        const a = l.attempts.find((a) => a.id === body.id),
          p = l.plans.find((p) => p.id === a?.planId)
        if (
          !a ||
          !p ||
          !(
            a.status === 'needs_reconciliation' ||
            (a.remoteStartedAt && !a.finishedAt && l.retired.includes(a.planId))
          ) ||
          p.digest !== body.digest ||
          p.snapshot.artifact.identity?.versionName !== body.versionName ||
          p.snapshot.artifact.identity?.buildNumber !== body.buildNumber ||
          a.reconciliation
        )
          throw new DomainError('保护记录不匹配或已有结论', 409)
        const present = body.decision === 'present'
        a.reconciliation = {
          source: 'local_user',
          checkedAt,
          decision:
            p.snapshot.action === 'apple_upload_build'
              ? present
                ? 'build_present'
                : 'no_build'
              : p.snapshot.action === 'huawei_save_draft'
                ? present
                  ? 'draft_present'
                  : 'no_draft'
                : present
                  ? 'submission_present'
                  : 'not_submitted',
        }
      } else if (body.kind === 'apple') {
        const r = l.appleReviews.find((r) => r.id === body.id)
        if (
          !r ||
          !(r.status === 'unknown' || (r.status === 'running' && l.retired.includes(r.id))) ||
          r.digest !== body.digest ||
          r.snapshot.version.version !== body.versionName ||
          r.snapshot.build.number !== body.buildNumber ||
          r.reconciliation
        )
          throw new DomainError('保护记录不匹配或已有结论', 409)
        r.reconciliation = {
          source: 'local_user',
          checkedAt,
          decision: body.decision === 'present' ? 'present' : 'absent',
        }
      } else throw new DomainError('保护类型不正确', 400)
      await atomicLocal(this.file, l)
    })
  }

  /** 在计划原子替换之前保存；失败时不得发出写许可，保守的多余事实可以阻塞但不能放行。 */
  protect(
    plans: ReleasePlan[],
    attempts: ReleaseAttempt[],
    apple: AppleReviewRecord[],
    beforeAttempts: ReleaseAttempt[],
    beforeApple: AppleReviewRecord[],
  ): Promise<void> {
    return this.enqueue(() => this.protectNow(plans, attempts, apple, beforeAttempts, beforeApple))
  }
  private async protectNow(
    plans: ReleasePlan[],
    attempts: ReleaseAttempt[],
    apple: AppleReviewRecord[],
    beforeAttempts: ReleaseAttempt[],
    beforeApple: AppleReviewRecord[],
  ): Promise<void> {
    // 长函数保留原因：计划与 Apple 共享恢复屏障，写许可前必须一并核对未知目标和已受理身份。
    const l = await this.read()
    // 1. 新尝试与首次写许可都核对外部账本；旧回执补全及人工核对不算新发布。
    const starts = attempts.filter(
      (a) =>
        !beforeAttempts.some((p) => p.id === a.id) ||
        (a.remoteStartedAt && !beforeAttempts.find((p) => p.id === a.id)?.remoteStartedAt),
    )
    for (const a of starts) {
      const next = plans.find((p) => p.id === a.planId)
      if (
        !next ||
        l.readOnly ||
        l.retired.includes(next.id) ||
        (l.restoredAt !== null &&
          Date.parse(next.snapshot.preflight.createdAt) <= Date.parse(l.restoredAt))
      )
        throw new DomainError('恢复后的旧计划不可执行，请重新准备；跨安装恢复保持只读', 409)
      if (
        l.attempts.some(
          (old) =>
            old.id !== a.id &&
            l.plans.some(
              (p) => p.id === old.planId && attemptBlocksTarget(normalize(old), p, next),
            ),
        )
      )
        throw new DomainError('恢复前有已受理版本或待核对执行，请查看保护记录', 409)
      if (
        l.appleReviews.some(
          (r) =>
            r.snapshot.binding.appId === next.snapshot.binding.appId &&
            next.snapshot.binding.channel === 'app_store' &&
            (r.status === 'unknown' || (r.status === 'running' && r.remoteStartedAt)) &&
            !r.reconciliation,
        )
      )
        throw new DomainError('Apple 目标有恢复前待核对操作', 409)
    }
    const appleStarts = apple.filter(
      (r) =>
        r.status === 'running' &&
        (!beforeApple.some((p) => p.id === r.id && p.status === 'running') ||
          (r.remoteStartedAt && !beforeApple.find((p) => p.id === r.id)?.remoteStartedAt)),
    )
    for (const r of appleStarts) {
      if (l.readOnly || l.retired.includes(r.id))
        throw new DomainError('恢复后的旧审核意图不可执行，请重新准备', 409)
      if (
        l.appleReviews.some(
          (old) =>
            old.id !== r.id &&
            old.snapshot.binding.appId === r.snapshot.binding.appId &&
            ((!old.reconciliation &&
              (old.status === 'unknown' || (old.status === 'running' && !!old.remoteStartedAt))) ||
              ((old.status === 'succeeded' || old.reconciliation?.decision === 'present') &&
                old.snapshot.version.id === r.snapshot.version.id &&
                old.snapshot.action === r.snapshot.action)),
        )
      )
        throw new DomainError('恢复前 Apple 版本已受理或待核对', 409)
      if (
        l.attempts.some(
          (a) =>
            !a.reconciliation &&
            (a.status === 'needs_reconciliation' || (!!a.remoteStartedAt && !a.finishedAt)) &&
            l.plans.some(
              (p) =>
                p.id === a.planId &&
                p.snapshot.binding.channel === 'app_store' &&
                p.snapshot.binding.appId === r.snapshot.binding.appId,
            ),
        )
      )
        throw new DomainError('Apple 目标有恢复前待核对上传', 409)
    }
    // 2. 相同 ID 只由当前活跃代演进；恢复时先退役，避免旧失败覆盖账本中较新的成功事实。
    const merge = <T extends { id: string }>(old: T[], next: T[], retired: (v: T) => boolean) => [
      ...old.filter((p) => !next.some((n) => n.id === p.id && !retired(n))),
      ...next.filter((n) => !retired(n) || !old.some((p) => p.id === n.id)),
    ]
    for (const a of attempts) {
      const old = l.attempts.find((p) => p.id === a.id)
      if (
        old &&
        !old.reconciliation &&
        a.reconciliation &&
        old.planDigest === a.planDigest &&
        old.finishedAt === a.finishedAt
      )
        old.reconciliation = structuredClone(a.reconciliation)
    }
    for (const r of apple) {
      const old = l.appleReviews.find((p) => p.id === r.id)
      if (
        old &&
        !old.reconciliation &&
        r.reconciliation &&
        old.digest === r.digest &&
        old.finishedAt === r.finishedAt
      )
        old.reconciliation = structuredClone(r.reconciliation)
    }
    l.plans = merge(l.plans, plans, (p) => l.retired.includes(p.id))
    l.attempts = merge(l.attempts, attempts, (a) => l.retired.includes(a.planId))
    l.appleReviews = merge(l.appleReviews, apple, (r) => l.retired.includes(r.id))
    await atomicLocal(this.file, l)
  }
}
function normalize(a: ReleaseAttempt): ReleaseAttempt {
  return a.remoteStartedAt && !a.finishedAt
    ? { ...a, status: 'needs_reconciliation', code: 'needs_reconciliation' }
    : a
}
