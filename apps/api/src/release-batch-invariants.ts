/** @description 批次同文件关联与不可变规则；队列内读写共用，拒绝孤立授权、跨应用计划及超额执行。 */
import {
  isReleaseBatch,
  type ReleaseBatch,
  type ReleasePlan,
  type ReleaseAttempt,
  type BatchRevision,
  type AppleReviewRecord,
} from '@release-harbor/contracts'
import { planFingerprint } from '@release-harbor/domain'

/** 只有准备及运行在占用批次，终态不阻挡后续独立操作。 */
export function activeBatch(batch: ReleaseBatch): boolean {
  return batch.revisions.some(
    (r) => r.preparedAt === null || (r.run !== null && r.run.finishedAt === null),
  )
}
/** 摘要只依赖不可变输入、顺序和服务端子计划；进度不改变用户确认内容。 */
export function batchDigest(revision: BatchRevision, plans: ReleasePlan[]): string {
  return planFingerprint({
    id: revision.id,
    targets: revision.targets.map((t) => ({
      id: t.id,
      input: t.input,
      planId: t.planId,
      digest: plans.find((p) => p.id === t.planId)?.digest ?? null,
    })),
  })
}
/** 单计划及旧确认入口必须拒绝任何已归属批次的快照。 */
export function isBatchPlan(batches: ReleaseBatch[], planId: string): boolean {
  return batches.some((b) => b.revisions.some((r) => r.targets.some((t) => t.planId === planId)))
}
/** 跨记录约束在原子替换之前也执行，不能写入下次启动才发现的坏关联。
 * 长函数保留原因：形状、关联和历史不可变性共同定义一个聚合不变量，集中检查避免遗漏交叉引用。 */
export function assertBatchRelations(
  batches: ReleaseBatch[],
  plans: ReleasePlan[],
  attempts: ReleaseAttempt[],
  previous: ReleaseBatch[] = [],
  appleReviews: AppleReviewRecord[] = [],
): void {
  // 1. 完整标识与全局预约先校验；写槽不能由旁路存储调用越过。
  if (
    new Set(attempts.map((a) => a.id)).size !== attempts.length ||
    !batches.every(isReleaseBatch) ||
    new Set(batches.map((b) => b.id)).size !== batches.length ||
    new Set(batches.map((b) => b.requestId)).size !== batches.length ||
    batches.filter(activeBatch).length > 1
  )
    throw Error('无效批次记录')
  const active = batches.find(activeBatch)
  if (
    active &&
    (appleReviews.some((r) => r.status === 'running') ||
      attempts.some(
        (a) =>
          !a.finishedAt &&
          (!a.origin ||
            a.origin.batchId !== active.id ||
            !active.revisions.some(
              (r) => r.id === a.origin?.revisionId && r.run && !r.run.finishedAt,
            )),
      ))
  )
    throw Error('批次预约与全局执行槽冲突')
  // 2. 子计划、尝试与证明必须属于同一确切目标，不能拼装其他快照取得许可。
  const identifiers = new Set<string>()
  function unique(id: string): void {
    if (identifiers.has(id)) throw Error('批次标识重复')
    identifiers.add(id)
  }
  const owned = new Set<string>()
  const batchIds = new Set<string>()
  for (const b of batches) {
    unique(b.id)
    for (const r of b.revisions) {
      unique(r.id)
      if (r.run) {
        unique(r.run.id)
        unique(r.run.consent.id)
      }
      if (
        r.run &&
        (!r.digest ||
          !r.preparedAt ||
          r.targets.some((t) => ['pending', 'checking', 'ready'].includes(t.status)))
      )
        throw Error('批次运行状态无效')
      if (
        r.run?.finishedAt &&
        r.targets.some((t) => ['queued', 'verifying', 'running'].includes(t.status))
      )
        throw Error('批次结束仍有进行中目标')
      if (r.digest !== null && r.digest !== batchDigest(r, plans)) throw Error('批次摘要不一致')
      for (const t of r.targets) {
        unique(t.id)
        batchIds.add(t.id)
        unique(t.preparationId)
        batchIds.add(t.preparationId)
        if (
          !r.run &&
          (t.attemptId ||
            t.validation ||
            !['pending', 'checking', 'ready', 'failed', 'interrupted'].includes(t.status))
        )
          throw Error('无授权批次包含执行事实')
        if (
          ['ready', 'queued', 'verifying', 'running', 'succeeded', 'needs_reconciliation'].includes(
            t.status,
          ) &&
          !t.planId
        )
          throw Error('目标状态缺少计划')
        if (
          ['verifying', 'running', 'succeeded', 'needs_reconciliation'].includes(t.status) &&
          !t.attemptId
        )
          throw Error('目标状态缺少尝试')
        const p = plans.find((p) => p.id === t.planId)
        if (t.planId !== null) {
          if (
            !p ||
            owned.has(p.id) ||
            p.requestId !== t.preparationId ||
            p.status !== 'frozen' ||
            p.authorization !== null ||
            p.snapshot.application.workspaceId !== b.workspaceId ||
            p.snapshot.application.projectId !== b.projectId ||
            p.snapshot.application.id !== b.applicationId ||
            p.snapshot.application.platform !== 'android' ||
            p.snapshot.action === 'huawei_submit_review' ||
            p.snapshot.binding.id !== t.input.bindingId ||
            p.snapshot.binding.revision !== t.input.expectedBindingRevision ||
            p.snapshot.artifact.id !== t.input.artifactId ||
            p.snapshot.artifact.sha256 !== t.input.expectedArtifactSha256 ||
            p.snapshot.releaseNotes !== t.input.releaseNotes ||
            planFingerprint(p.snapshot.releasePolicy) !== planFingerprint(t.input.releasePolicy)
          )
            throw Error('批次子计划关联无效')
          owned.add(p.id)
        }
        const a = attempts.find((a) => a.id === t.attemptId)
        if (
          t.attemptId !== null &&
          (!a ||
            !r.run ||
            !p ||
            a.planId !== p.id ||
            a.planDigest !== p.digest ||
            a.authorizationId !== r.run.consent.id ||
            a.origin?.batchId !== b.id ||
            a.origin.revisionId !== r.id ||
            a.origin.targetId !== t.id)
        )
          throw Error('批次尝试关联无效')
        if (
          t.validation !== null &&
          (!a ||
            !p ||
            !a.remoteStartedAt ||
            t.validation.batchId !== b.id ||
            t.validation.revisionId !== r.id ||
            t.validation.targetId !== t.id ||
            t.validation.attemptId !== a.id ||
            t.validation.planDigest !== p.digest ||
            t.validation.profileRevision !== p.snapshot.preflight.profileRevision ||
            t.validation.artifactSha256 !== p.snapshot.artifact.sha256 ||
            Date.parse(t.validation.checkedAt) < Date.parse(a.createdAt) ||
            Date.parse(t.validation.checkedAt) > Date.parse(a.remoteStartedAt) ||
            Date.parse(a.remoteStartedAt) - Date.parse(t.validation.checkedAt) > 300000 ||
            !r.run ||
            Date.parse(a.remoteStartedAt) >= Date.parse(r.run.consent.expiresAt) ||
            Date.parse(a.remoteStartedAt) < Date.parse(r.run.consent.issuedAt))
        )
          throw Error('批次证明关联无效')
        if (a?.remoteStartedAt && !t.validation) throw Error('批次写许可缺少证明')
        if (
          ['running', 'succeeded', 'needs_reconciliation'].includes(t.status) &&
          !a?.remoteStartedAt
        )
          throw Error('执行状态缺少写许可')
        if (t.status === 'succeeded' && a?.status !== 'succeeded') throw Error('成功事实不一致')
        if (t.status === 'needs_reconciliation' && a?.status !== 'needs_reconciliation')
          throw Error('未知事实不一致')
      }
      if (r.run && r.targets.some((t) => !t.planId)) throw Error('批次运行缺少计划')
    }
  }
  if (attempts.some((a) => batchIds.has(a.id))) throw Error('批次标识与尝试冲突')
  for (const a of attempts.filter((a) => a.origin))
    if (
      !batches.some(
        (b) =>
          b.id === a.origin?.batchId &&
          b.revisions.some(
            (r) =>
              r.id === a.origin?.revisionId &&
              r.targets.some((t) => t.id === a.origin?.targetId && t.attemptId === a.id),
          ),
      )
    )
      throw Error('孤立批次尝试')
  // 3. 已准备的输入和子计划不能被覆盖；停止／终态及既有证明、授权均只追加一次。
  for (const old of previous) {
    const next = batches.find((b) => b.id === old.id)
    if (
      !next ||
      old.requestId !== next.requestId ||
      old.createdAt !== next.createdAt ||
      old.workspaceId !== next.workspaceId ||
      old.projectId !== next.projectId ||
      old.applicationId !== next.applicationId
    )
      throw Error('禁止覆盖批次归属')
    for (const r of old.revisions) {
      const n = next.revisions.find((n) => n.id === r.id)
      if (
        !n ||
        r.requestId !== n.requestId ||
        r.createdAt !== n.createdAt ||
        planFingerprint(
          r.targets.map((t) => ({ id: t.id, input: t.input, preparationId: t.preparationId })),
        ) !==
          planFingerprint(
            n.targets.map((t) => ({ id: t.id, input: t.input, preparationId: t.preparationId })),
          ) ||
        (r.preparedAt !== null && (r.preparedAt !== n.preparedAt || r.digest !== n.digest)) ||
        (r.run &&
          (!n.run ||
            r.run.id !== n.run.id ||
            r.run.requestId !== n.run.requestId ||
            planFingerprint(r.run.consent) !== planFingerprint(n.run.consent) ||
            (r.run.stoppedAt !== null && r.run.stoppedAt !== n.run.stoppedAt) ||
            (r.run.finishedAt !== null && r.run.finishedAt !== n.run.finishedAt)))
      )
        throw Error('禁止覆盖批次版本或同意')
      for (const t of r.targets) {
        const nt = n.targets.find((v) => v.id === t.id)
        if (
          !nt ||
          (t.planId !== null && t.planId !== nt.planId) ||
          (t.attemptId !== null && t.attemptId !== nt.attemptId) ||
          (t.validation && planFingerprint(t.validation) !== planFingerprint(nt.validation)) ||
          (r.preparedAt !== null &&
            [
              'failed',
              'succeeded',
              'needs_reconciliation',
              'stopped',
              'expired',
              'interrupted',
            ].includes(t.status) &&
            t.status !== nt.status)
        )
          throw Error('禁止覆盖批次目标事实')
      }
    }
  }
}
