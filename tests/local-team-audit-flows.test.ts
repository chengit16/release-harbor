/** @description 批次与 Apple 操作者关联验收；合成官方响应和执行器，核对许可、回执、幂等及旧历史不回填。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { setup } from './fixtures/release-plans.ts'
import { appleReviewTestClient } from './fixtures/apple-review.ts'
import { inspectAppleReview } from '../packages/provider-app-ship/src/apple-review-source.ts'
import { AppleReviewService } from '../apps/api/src/apple-review.service.ts'
import { LocalTeamPolicy } from '../apps/api/src/local-team/policy.ts'
import { TeamAuditQuery } from '../apps/api/src/local-team/audit-query.ts'
import { teamContext } from '../apps/api/src/local-team/access.ts'
import type { TeamActor } from '../apps/api/src/local-team/access.ts'

const secret = ['synthetic', 'audit', 'flows'].join('-')
async function actors(
  f: Awaited<ReturnType<typeof setup>>,
): Promise<{ preparer: TeamActor; confirmer: TeamActor }> {
  assert.ok(f.team)
  await f.team.initialize('admin', secret)
  const admin = (await f.team.read())?.[0]
  assert.ok(admin)
  const m = await f.team.add('preparer', secret)
  await f.team.setPermissions(m.id, {
    revision: 0,
    menus: ['releases'],
    grants: [],
    applications: [
      {
        projectId: f.application.projectId,
        applicationId: f.application.id,
        operations: ['release_prepare'],
      },
    ],
  })
  return {
    preparer: { store: f.team, id: m.id, revision: 1 },
    confirmer: { store: f.team, id: admin.id, revision: admin.revision },
  }
}

test('批次准备、确认、子目标尝试与首次许可分别保存原操作者；刷新不重发', async (t) => {
  const f = await setup(
    t,
    'android',
    {
      async run(plan, attemptId, permit, _diagnostic, batch) {
        assert.ok(batch)
        await permit({
          batchId: batch.batchId,
          revisionId: batch.revisionId,
          targetId: batch.targetId,
          attemptId,
          planDigest: plan.digest,
          checkedAt: batch.consent.issuedAt,
          artifactSha256: plan.snapshot.artifact.sha256 ?? '',
          profileRevision: plan.snapshot.preflight.profileRevision,
          scope: 'artifact_profile_merchant_source',
        })
        return 'draft_saved'
      },
      close() {},
    },
    { team: true },
  )
  const a = await actors(f)
  const batch = await teamContext.run(a.preparer, () =>
    f.batches.create(...f.args, {
      requestId: randomUUID(),
      targets: [
        {
          bindingId: f.binding.id,
          artifactId: f.artifact.id,
          expectedBindingRevision: 1,
          expectedArtifactSha256: f.artifact.sha256,
          releaseNotes: '合成批次更新说明',
          releasePolicy: { mode: 'after_approval' },
        },
      ],
    }),
  )
  await teamContext.run(a.preparer, () =>
    f.batches.prepare(...f.args, batch.id, {
      requestId: randomUUID(),
      expectedRevision: batch.editVersion,
    }),
  )
  let saved = await f.batches.get(...f.args, batch.id)
  for (let i = 0; i < 200 && !saved.revisions[0]?.preparedAt; i++) {
    await delay(5)
    saved = await f.batches.get(...f.args, batch.id)
  }
  const revision = saved.revisions[0]
  assert.ok(revision?.digest)
  const body = { expectedDigest: revision.digest, requestId: randomUUID(), acknowledged: true }
  await teamContext.run(a.confirmer, () =>
    f.batches.confirm(...f.args, batch.id, revision.id, body),
  )
  for (let i = 0; i < 200 && !saved.revisions[0]?.run?.finishedAt; i++) {
    await delay(5)
    saved = await f.batches.get(...f.args, batch.id)
  }
  assert.ok(saved.revisions[0]?.run?.finishedAt)
  assert.equal((await f.execution.list(...f.args))[0]?.status, 'succeeded')
  assert.ok(f.team)
  const admin = (await f.team.read())?.find((m) => m.id === a.confirmer.id)
  assert.ok(admin)
  const query = new TeamAuditQuery(
    f.team,
    new LocalTeamPolicy({ releasePlans: f.plans, execution: f.execution, batches: f.batches }),
  )
  const logs = await query.record(
    admin,
    f.application.projectId,
    f.application.id,
    'batch',
    batch.id,
  )
  assert.equal(logs.items.filter((e) => e.action === 'release_prepare').length, 2)
  assert.ok(
    logs.items
      .filter((e) => e.action === 'release_prepare')
      .every((e) => e.actor.id === a.preparer.id),
  )
  assert.ok(
    logs.items
      .filter((e) => e.action !== 'release_prepare')
      .every((e) => e.actor.id === a.confirmer.id),
  )
  assert.equal(logs.items.find((e) => e.action === 'release_permit')?.outcome?.status, 'succeeded')
  await teamContext.run(a.confirmer, () =>
    f.batches.confirm(...f.args, batch.id, revision.id, body),
  )
  assert.equal(
    (await query.record(admin, f.application.projectId, f.application.id, 'batch', batch.id)).total,
    logs.total,
  )
})

test('Apple 已有构建审计关联消费、许可及人工核对；旧记录在启用团队后仍无操作者', async (t) => {
  const f = await setup(t, 'ios', undefined, { team: true })
  const n = await appleReviewTestClient(
    join(f.root, 'synthetic-vault.json'),
    f.binding,
    f.application.identifier,
  )
  let writes = 0
  const apple = new AppleReviewService(f.catalog, f.preflights, f.store, {
    async run(job, permit) {
      if (job.kind === 'prepare')
        return {
          ok: true,
          value: (
            await inspectAppleReview(
              n.client,
              job.binding,
              job.identifier,
              job.buildId,
              job.versionId,
              job.action,
              job.mode,
              job.notes,
              'a'.repeat(64),
            )
          ).snapshot,
        }
      if (job.kind === 'execute') {
        await permit?.()
        writes++
        return { ok: false, code: 'unknown' }
      }
      return { ok: false, code: 'interrupted' }
    },
    close() {},
  })
  t.after(() => apple.onModuleDestroy())
  const input = {
    requestId: randomUUID(),
    bindingId: f.binding.id,
    buildId: 'B1',
    versionId: 'V1',
    action: 'submit',
    mode: 'manual',
    notes: '合成审核说明',
  }
  const legacy = await apple.prepare(f.application.projectId, f.application.id, input)
  const a = await actors(f)
  const record = await teamContext.run(a.preparer, () =>
    apple.prepare(f.application.projectId, f.application.id, { ...input, requestId: randomUUID() }),
  )
  const decision = { expectedDigest: record.digest, acknowledged: true }
  await teamContext.run(a.confirmer, () =>
    apple.execute(f.application.projectId, f.application.id, record.id, decision),
  )
  let saved = await apple.list(f.application.projectId, f.application.id)
  for (let i = 0; i < 100 && !saved.find((r) => r.id === record.id)?.finishedAt; i++) {
    await delay(5)
    saved = await apple.list(f.application.projectId, f.application.id)
  }
  assert.equal(saved.find((r) => r.id === record.id)?.status, 'unknown')
  await teamContext.run(a.confirmer, () =>
    apple.reconcile(f.application.projectId, f.application.id, record.id, {
      ...decision,
      version: '1.2.3',
      build: '42',
      decision: 'present',
    }),
  )
  assert.ok(f.team)
  const admin = (await f.team.read())?.find((m) => m.id === a.confirmer.id)
  assert.ok(admin)
  const query = new TeamAuditQuery(
    f.team,
    new LocalTeamPolicy({ releasePlans: f.plans, appleReview: apple }),
  )
  const logs = await query.record(
    admin,
    f.application.projectId,
    f.application.id,
    'apple',
    record.id,
  )
  assert.deepEqual(
    logs.items.map((e) => e.action),
    ['release_reconcile', 'release_permit', 'release_confirm', 'release_prepare'],
  )
  assert.equal(logs.items.find((e) => e.action === 'release_prepare')?.actor.id, a.preparer.id)
  assert.ok(
    logs.items
      .filter((e) => e.action !== 'release_prepare')
      .every((e) => e.actor.id === a.confirmer.id),
  )
  assert.ok(
    logs.items
      .filter((e) => e.action !== 'release_prepare')
      .every((e) => e.outcome?.id === record.id && e.outcome.status === 'unknown'),
  )
  assert.equal(
    (await query.record(admin, f.application.projectId, f.application.id, 'apple', legacy.id))
      .total,
    0,
  )
  assert.equal(writes, 1)
})
