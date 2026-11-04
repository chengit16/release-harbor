/** @description 计划列表以真实执行结果呈现状态，不能把授权消费或未上传的失败显示为发布成功。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { setup, terminal } from './fixtures/release-plans.ts'
import {
  planStatus,
  attemptStatus,
  reconciliationStatus,
} from '../apps/web/src/pages/releasePlans/releaseStatus.ts'

test('仍有效的已确认小米计划执行前失败时，列表显示未上传而非绿色授权状态', async (t) => {
  const f = await setup(
    t,
    'android',
    {
      async run() {
        return 'verification_failed'
      },
      close() {},
    },
    { channel: 'xiaomi' },
  )
  const plan = await f.plans.freeze(...f.args, f.input)
  await f.execution.start(
    ...f.args,
    plan.id,
    { expectedDigest: plan.digest, acknowledged: true },
    true,
  )
  const attempt = await terminal(f),
    view = (await f.plans.list(...f.args))[0]
  assert.ok(view)
  assert.equal(view.plan.status, 'confirmed')
  assert.equal(view.current, true)
  assert.equal(attempt.remoteStartedAt, null)
  assert.equal(planStatus(view, attempt).label, '提交前失败 · 未上传')
  assert.equal(planStatus(view, attempt).color, 'error')
})

test('小米受理、华为草稿与未知终态分别展示，不用一个授权消费标签掩盖结果', async (t) => {
  for (const channel of ['xiaomi', 'huawei'] as const) {
    const f = await setup(
      t,
      'android',
      {
        async run(_plan, _id, permit) {
          await permit()
          return channel === 'xiaomi' ? 'review_submitted' : 'draft_saved'
        },
        close() {},
      },
      { channel },
    )
    const p = await f.plans.freeze(...f.args, f.input)
    await f.execution.start(...f.args, p.id, { expectedDigest: p.digest, acknowledged: true }, true)
    const attempt = await terminal(f)
    assert.equal(attemptStatus(attempt).label, channel === 'xiaomi' ? '已提交审核' : '草稿已保存')
    assert.equal(attemptStatus(attempt).color, 'success')
  }
  const f = await setup(t, 'android', {
    async run(_p, _id, permit) {
      await permit()
      return 'needs_reconciliation'
    },
    close() {},
  })
  const p = await f.plans.freeze(...f.args, f.input)
  await f.execution.start(...f.args, p.id, { expectedDigest: p.digest, acknowledged: true }, true)
  assert.equal(attemptStatus(await terminal(f)).label, '待核对')
  assert.equal(attemptStatus(await terminal(f)).color, 'warning')
  assert.match(reconciliationStatus('submission_present'), /审核提交已存在/)
  assert.match(reconciliationStatus('not_submitted'), /未提交/)
})
