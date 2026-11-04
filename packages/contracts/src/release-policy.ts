/** @description 跨 Android／iOS 的审核后上架意图；不表示审核通过、上传预约或商店设置已生效。 */
import { isRecord } from './applications.ts'

/** 定时表示审核通过且不早于指定时点；notBefore 是带 Z 的规范 UTC，页面按设备时区展示。 */
export type ReleasePolicy = { mode: 'after_approval' } | { mode: 'scheduled'; notBefore: string }

/** 磁盘恢复只校验结构，不因过去的历史时间拒绝整个文件。 */
export function isReleasePolicy(value: unknown): value is ReleasePolicy {
  if (!isRecord(value)) return false
  if (value.mode === 'after_approval') return Object.keys(value).length === 1
  return (
    value.mode === 'scheduled' &&
    Object.keys(value).length === 2 &&
    typeof value.notBefore === 'string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.notBefore) &&
    Number.isFinite(Date.parse(value.notBefore)) &&
    new Date(value.notBefore).toISOString() === value.notBefore
  )
}

/** 本次受理与执行使用当前时间复核，不能把过期定时降级成立即上架。 */
export function isReleasePolicyCurrent(policy: ReleasePolicy | undefined, now: number): boolean {
  return !policy || policy.mode === 'after_approval' || Date.parse(policy.notBefore) > now
}
