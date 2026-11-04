/** @description 发布计划同源 API，只提交公开意图与明确确认，执行只发送确定计划，不自动重试。 */
import {
  type ReconcileAttemptInput,
  type PrepareReleaseInput,
  type ReleasePreparation,
  isReleasePreparation,
  isReleaseAttempt,
  type ReleaseAttempt,
  isReleasePlan,
  isReleasePlanView,
  type CreateReleasePlan,
  type ReleasePlan,
  type ReleasePlanView,
} from '@release-harbor/contracts'
import { item, items, json, request } from '../client.ts'
function root(projectId: string, applicationId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/applications/${encodeURIComponent(applicationId)}/release-plans`
}
function mutation(body: unknown, signal?: AbortSignal): RequestInit {
  return {
    ...json('POST', body, signal),
    headers: { 'Content-Type': 'application/json', 'X-Release-Harbor-Plan': '1' },
  }
}
/** 查询当前有效性；不自动确认或重复派发。 */
export function listReleasePlans(
  projectId: string,
  applicationId: string,
  signal: AbortSignal,
): Promise<ReleasePlanView[]> {
  return request(root(projectId, applicationId), items(isReleasePlanView), {
    signal,
    cache: 'no-store',
  })
}
/** 冻结绑定既有预检的不可变意图；请求 ID 由本次草稿产生。 */
export function freezeReleasePlan(
  projectId: string,
  applicationId: string,
  input: CreateReleasePlan,
  signal: AbortSignal,
): Promise<ReleasePlan> {
  return request(
    root(projectId, applicationId),
    item('plan', isReleasePlan),
    mutation(input, signal),
  )
}
/** 操作仅针对已展示的摘要；响应不明先查询，禁止自动重放。 */
export function decideReleasePlan(
  projectId: string,
  applicationId: string,
  plan: ReleasePlan,
  decision: 'confirm' | 'cancel',
  signal: AbortSignal,
): Promise<ReleasePlan> {
  return request(
    root(projectId, applicationId) + '/' + encodeURIComponent(plan.id) + '/' + decision,
    item('plan', isReleasePlan),
    mutation(
      decision === 'confirm'
        ? { expectedDigest: plan.digest, acknowledged: true }
        : { expectedDigest: plan.digest },
      signal,
    ),
  )
}

/** 执行仅提交已展示摘要；调用失败只能查询回执，不自动重放。 */
export function executeReleasePlan(
  projectId: string,
  applicationId: string,
  plan: ReleasePlan,
  signal: AbortSignal,
): Promise<ReleaseAttempt> {
  return request(
    root(projectId, applicationId) + '/' + encodeURIComponent(plan.id) + '/confirm-and-execute',
    item('attempt', isReleaseAttempt),
    mutation({ expectedDigest: plan.digest, acknowledged: true }, signal),
  )
}
/** 查询安全回执，不请求商店。 */
export function listReleaseAttempts(
  projectId: string,
  applicationId: string,
  signal: AbortSignal,
): Promise<ReleaseAttempt[]> {
  return request(
    root(projectId, applicationId).replace(/release-plans$/, 'release-attempts'),
    items(isReleaseAttempt),
    { signal, cache: 'no-store' },
  )
}

/** 人工结论不会重放执行；正文仅含固定结论、摘要与核对版本。 */
export function reconcileReleaseAttempt(
  projectId: string,
  applicationId: string,
  attemptId: string,
  input: ReconcileAttemptInput,
  signal: AbortSignal,
): Promise<ReleaseAttempt> {
  return request(
    root(projectId, applicationId).replace(/release-plans$/, 'release-attempts') +
      '/' +
      encodeURIComponent(attemptId) +
      '/reconcile',
    item('attempt', isReleaseAttempt),
    mutation(input, signal),
  )
}

/** 受理只读准备；相同草稿请求编号去重，没有商店写入。 */
export function prepareRelease(
  projectId: string,
  applicationId: string,
  input: PrepareReleaseInput,
  signal: AbortSignal,
): Promise<ReleasePreparation> {
  return request(
    root(projectId, applicationId).replace(/release-plans$/, 'release-preparations'),
    item('preparation', isReleasePreparation),
    mutation(input, signal),
  )
}
/** 刷新原进度，绝不在读取中重放预检或确认。 */
export function listReleasePreparations(
  projectId: string,
  applicationId: string,
  signal: AbortSignal,
): Promise<ReleasePreparation[]> {
  return request(
    root(projectId, applicationId).replace(/release-plans$/, 'release-preparations'),
    items(isReleasePreparation),
    { signal, cache: 'no-store' },
  )
}
