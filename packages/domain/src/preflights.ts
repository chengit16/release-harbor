/** @description 只读预检输入和失效规则，独立于存储、框架及 SDK。 */
import {
  isProfileRevision,
  isRecord,
  type CreatePreflight,
  type PreflightRecord,
  type PreflightView,
  type ChannelBinding,
  type ArtifactRecord,
  type ProfileCatalog,
} from '@release-harbor/contracts'
import { DomainError } from './errors.ts'

/** 未知字段及浏览器伪造的核验状态一律拒绝。 */
export function validatePreflightInput(value: unknown): CreatePreflight {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 4 ||
    !['bindingId', 'artifactId'].every(
      (k) => typeof value[k] === 'string' && /^[a-f0-9-]{36}$/.test(value[k]),
    ) ||
    typeof value.expectedBindingRevision !== 'number' ||
    !Number.isSafeInteger(value.expectedBindingRevision) ||
    value.expectedBindingRevision < 1 ||
    !isProfileRevision(value.expectedProfileRevision)
  )
    throw new DomainError('请提供商店绑定、产物及其当前版本')
  return {
    bindingId: String(value.bindingId),
    artifactId: String(value.artifactId),
    expectedBindingRevision: value.expectedBindingRevision,
    expectedProfileRevision: value.expectedProfileRevision,
  }
}

/** 事实保留不改写；任何依赖变化及超时都不能继续作为当前通过结果。 */
export function preflightView(
  record: PreflightRecord,
  binding: ChannelBinding | undefined,
  artifact: ArtifactRecord | undefined,
  catalog: ProfileCatalog,
  now: number,
  bytesMatch: boolean,
): PreflightView {
  const profile = catalog.profiles.find(
    (p) =>
      p.reference === record.credentialReference && p.channel === binding?.channel && p.configured,
  )
  const invalidatedBy: PreflightView['invalidatedBy'] =
    !binding || binding.revision !== record.bindingRevision
      ? 'binding_changed'
      : !artifact ||
          artifact.status !== 'ready' ||
          artifact.sha256 !== record.artifactSha256 ||
          !bytesMatch
        ? 'artifact_changed'
        : catalog.code !== 'available' || !profile
          ? 'profile_unavailable'
          : profile.revision !== record.profileRevision
            ? 'profile_changed'
            : record.expiresAt && now >= Date.parse(record.expiresAt)
              ? 'expired'
              : null
  return { record, invalidatedBy, current: record.status === 'passed' && invalidatedBy === null }
}
