/** @description 第四期回归：跨时区和秒级精度不得提前发布，执行阶段回执不冒充审核通过或上架。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { isReleaseAttempt, type ReleaseAttempt } from '../packages/contracts/src/index.ts'
import {
  releaseChinaTime,
  releaseEpochSeconds,
  releaseUtcTime,
} from '../packages/provider-app-ship/src/release-time.ts'
import { attemptStatus } from '../apps/web/src/pages/releasePlans/releaseStatus.ts'

test('渠道秒级时间跨日／跨年向后取整，UTC 与中国时间代表相同时刻且不受进程时区影响', () => {
  for (const [requested, seconds, utc, china] of [
    ['2099-01-01T00:00:00.000Z', 4070908800, '2099-01-01T00:00:00+0000', '2099-01-01 08:00:00'],
    ['2098-12-31T23:59:59.001Z', 4070908800, '2099-01-01T00:00:00+0000', '2099-01-01 08:00:00'],
    ['2098-12-31T15:59:59.999Z', 4070880000, '2098-12-31T16:00:00+0000', '2099-01-01 00:00:00'],
  ] as const) {
    assert.equal(releaseEpochSeconds(requested), seconds)
    assert.equal(releaseUtcTime(requested), utc)
    assert.equal(releaseChinaTime(requested), china)
    const sent = Date.parse(utc)
    assert.ok(sent >= Date.parse(requested))
    assert.ok(sent - Date.parse(requested) < 1000)
    assert.equal(Date.parse(china.replace(' ', 'T') + '+08:00'), sent)
  }
  assert.throws(() => releaseUtcTime('invalid'), /invalid_release_time/)
})

test('上传／草稿／版本处理／更新受理和送审各保留阶段语义，不将执行成功呈现为已上架', () => {
  const base: ReleaseAttempt = {
    id: randomUUID(),
    planId: randomUUID(),
    authorizationId: randomUUID(),
    planDigest: 'a'.repeat(64),
    status: 'succeeded',
    code: 'draft_saved',
    createdAt: '2026-11-08T00:00:00.000Z',
    remoteStartedAt: '2026-11-08T00:00:01.000Z',
    finishedAt: '2026-11-08T00:00:02.000Z',
  }
  for (const [code, expected] of [
    ['build_uploaded', '上传已接收 · 待核对构建'],
    ['build_processing', '构建处理中'],
    ['build_available', '构建可用'],
    ['draft_saved', '草稿已保存'],
    ['oppo_version_processed', '版本处理成功'],
    ['vivo_update_accepted', '更新已接收'],
    ['huawei_review_submitted', '已提交审核'],
    ['review_submitted', '已提交审核'],
    ['meizu_review_submitted', '已提交审核'],
    ['honor_review_submitted', '已提交审核'],
    ['tencent_review_submitted', '已提交审核'],
    ['harmony_review_submitted', '已提交审核'],
  ] as const) {
    const attempt = { ...base, code }
    assert.ok(isReleaseAttempt(attempt))
    assert.equal(attemptStatus(attempt).label, expected)
    assert.notEqual(attemptStatus(attempt).label, '已上架')
    assert.equal(isReleaseAttempt({ ...attempt, remoteStartedAt: null }), false)
  }
  const unknown: ReleaseAttempt = {
    ...base,
    status: 'needs_reconciliation',
    code: 'needs_reconciliation',
    diagnostic: 'oppo_task_pending',
  }
  assert.ok(isReleaseAttempt(unknown))
  assert.equal(attemptStatus(unknown).label, '待核对')
  assert.match(attemptStatus(unknown).description, /仍在处理中/)
  assert.equal(isReleaseAttempt({ ...unknown, status: 'succeeded' }), false)
})
