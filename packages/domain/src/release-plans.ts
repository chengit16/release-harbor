/** @description 发布计划的输入、稳定指纹与失效规则，不依赖 HTTP、文件存储或商店 SDK。 */
import { createHash } from 'node:crypto'
import {
  hasExactKeys,
  isReleasePolicyCurrent,
  isPlanId,
  isProfileRevision,
  isRecord,
  isReleaseAction,
  isReleaseNotes,
  type CreateReleasePlan,
  type ReleasePlan,
  type ReleasePlanSnapshot,
  type ReleasePlanView,
  type PreflightView,
} from '@release-harbor/contracts'
import { validateReleasePolicy } from './release-policy.ts'
import { validateXiaomiUpdateDetails } from './xiaomi-updates.ts'
import { DomainError } from './errors.ts'

/** 固定键序的递归编码，JSON 属性顺序变化不得改变同一意图的摘要。 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (isRecord(value))
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + canonical(value[key]))
        .join(',') +
      '}'
    )
  return JSON.stringify(value) ?? 'null'
}
/** 仅对公开快照计算 SHA-256，不接受或处理秘密材料。 */
export function planFingerprint(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex')
}
/** 配置摘要明确排除更新说明及预检时间，便于复核具体变化来源。 */
export function configurationFingerprint(
  snapshot: Pick<ReleasePlanSnapshot, 'application' | 'binding' | 'artifact' | 'preflight'>,
): string {
  return planFingerprint({
    application: snapshot.application,
    binding: snapshot.binding,
    artifact: snapshot.artifact,
    profileRevision: snapshot.preflight.profileRevision,
  })
}
/** 说明按实际 UTF-8 字节计算，换行与空格变化均可识别。 */
export function notesFingerprint(notes: string): string {
  return createHash('sha256').update(notes, 'utf8').digest('hex')
}
/** 拒绝浏览器声明目标、摘要、凭据或授权状态，仅接受意图及已有预检。 */
export function validateReleasePlanInput(value: unknown): CreateReleasePlan {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'requestId',
      'preflightId',
      'action',
      'releaseNotes',
      ...(Object.hasOwn(value, 'xiaomi') ? ['xiaomi'] : []),
      ...(Object.hasOwn(value, 'releasePolicy') ? ['releasePolicy'] : []),
    ]) ||
    (value.action !== 'xiaomi_submit_review' && Object.hasOwn(value, 'xiaomi')) ||
    (isRecord(value.xiaomi) && Object.hasOwn(value.xiaomi, 'source')) ||
    !isPlanId(value.requestId) ||
    !isPlanId(value.preflightId) ||
    !isReleaseAction(value.action) ||
    (isRecord(value.releasePolicy) &&
      (value.action === 'apple_upload_build'
        ? value.releasePolicy.mode === 'scheduled'
        : value.releasePolicy.mode === 'manual')) ||
    (value.action === 'meizu_submit_review' &&
      (!isRecord(value.releasePolicy) || value.releasePolicy.mode !== 'after_approval')) ||
    ((value.action === 'tencent_submit_review' || value.action === 'harmony_submit_review') &&
      (!Object.hasOwn(value, 'releasePolicy') ||
        typeof value.releaseNotes !== 'string' ||
        (value.action === 'harmony_submit_review' && value.releaseNotes.length > 1000) ||
        (value.action === 'tencent_submit_review' &&
          /\p{Extended_Pictographic}/u.test(value.releaseNotes)))) ||
    (value.action === 'honor_submit_review' &&
      (!Object.hasOwn(value, 'releasePolicy') ||
        typeof value.releaseNotes !== 'string' ||
        value.releaseNotes.length > 500)) ||
    (value.action === 'vivo_submit_review' &&
      (typeof value.releaseNotes !== 'string' ||
        Array.from(value.releaseNotes.trim()).length < 5 ||
        Array.from(value.releaseNotes.trim()).length > 200 ||
        !Object.hasOwn(value, 'releasePolicy'))) ||
    (value.action === 'oppo_submit_review' &&
      (typeof value.releaseNotes !== 'string' ||
        Array.from(value.releaseNotes.trim()).length < 5 ||
        !Object.hasOwn(value, 'releasePolicy'))) ||
    typeof value.releaseNotes !== 'string' ||
    !isReleaseNotes(value.releaseNotes.trim())
  )
    throw new DomainError('请选择当前通过的预检、首期动作，并填写 1–4000 字更新说明')
  return {
    requestId: value.requestId,
    preflightId: value.preflightId,
    action: value.action,
    releaseNotes: value.releaseNotes.trim(),
    ...(Object.hasOwn(value, 'releasePolicy')
      ? { releasePolicy: validateReleasePolicy(value.releasePolicy) }
      : {}),
    ...(value.action === 'xiaomi_submit_review' && Object.hasOwn(value, 'xiaomi')
      ? { xiaomi: validateXiaomiUpdateDetails(value.xiaomi) }
      : {}),
  }
}
/** 确认必须明确同意当前摘要；取消只接受摘要，均拒绝额外字段。 */
export function validatePlanDecision(value: unknown, confirm: boolean): string {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, confirm ? ['expectedDigest', 'acknowledged'] : ['expectedDigest']) ||
    !isProfileRevision(value.expectedDigest) ||
    (confirm && value.acknowledged !== true)
  )
    throw new DomainError('请核对计划摘要并明确确认本次范围')
  return value.expectedDigest
}
/** 磁盘恢复与传输都不能把被修改的快照重新当成原确认。 */
export function planFingerprintsMatch(plan: ReleasePlan): boolean {
  return (
    plan.digest === planFingerprint(plan.snapshot) &&
    plan.snapshot.notesDigest === notesFingerprint(plan.snapshot.releaseNotes) &&
    plan.snapshot.configDigest === configurationFingerprint(plan.snapshot)
  )
}
/** 依赖动态重算，取消及过期均不改变历史快照；未来执行器仍须独立复验。 */
export function releasePlanView(
  plan: ReleasePlan,
  preflight: PreflightView | undefined,
  now: number,
): ReleasePlanView {
  const reason = preflight?.invalidatedBy
  const invalidatedBy: ReleasePlanView['invalidatedBy'] =
    plan.status === 'cancelled'
      ? 'cancelled'
      : !isReleasePolicyCurrent(plan.snapshot.releasePolicy, now)
        ? 'release_time_elapsed'
        : reason === 'expired' ||
            (plan.snapshot.preflight.expiresAt !== null &&
              now >= Date.parse(plan.snapshot.preflight.expiresAt))
          ? 'preflight_expired'
          : reason
            ? reason
            : !preflight?.current ||
                preflight.record.id !== plan.snapshot.preflight.id ||
                planFingerprint(preflight.record) !== planFingerprint(plan.snapshot.preflight)
              ? 'preflight_unavailable'
              : plan.authorization && now >= Date.parse(plan.authorization.expiresAt)
                ? 'authorization_expired'
                : null
  return { plan, current: invalidatedBy === null, invalidatedBy }
}
