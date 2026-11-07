/** @description 状态查询私有协议，仅允许已接入渠道的固定只读任务；网页不能指定目标、凭据目录或 HTTP 方法。 */
import {
  isRecord,
  isReviewAnchor,
  type ReviewAnchor,
  isChannelBinding,
  hasExactKeys,
  type ChannelBinding,
  type ReleaseObservationResult,
} from '@release-harbor/contracts'
/** 父进程从已执行计划及当前绑定核对后构造，账号引用只在可信 Node 边界内使用。 */
export interface ReleaseObservationJob {
  binding: ChannelBinding
  identifier: string
  versionName: string
  buildNumber: string
  /** 魅族必需原执行锚点；荣耀新记录可提供审核单，旧记录保持当前版本匹配。 */
  reviewAnchor?: ReviewAnchor
  /** 已持久的荣耀审核通过结论，只继续读上架资料，不重复查询已结束审核单。 */
  knownAudit?: 1
}
/** 独立进程查询端口；结果必须通过公开白名单守卫，不提供远端写入许可。 */
export interface ReleaseObservationRunner {
  run(job: ReleaseObservationJob): Promise<ReleaseObservationResult>
  close(): void
}
/** 拒绝跨渠道与任意载荷，版本字段必须是非空有界字符串。 */
export function isReleaseObservationJob(value: unknown): value is ReleaseObservationJob {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'binding',
      'identifier',
      'versionName',
      'buildNumber',
      ...(Object.hasOwn(value, 'reviewAnchor') ? ['reviewAnchor'] : []),
      ...(Object.hasOwn(value, 'knownAudit') ? ['knownAudit'] : []),
    ]) &&
    isChannelBinding(value.binding) &&
    ((value.binding.channel === 'honor' &&
      (!Object.hasOwn(value, 'reviewAnchor') ||
        (isReviewAnchor(value.reviewAnchor) && value.reviewAnchor.channel === 'honor'))) ||
      (value.binding.channel === 'meizu' &&
        isReviewAnchor(value.reviewAnchor) &&
        value.reviewAnchor.channel === 'meizu')) &&
    (!Object.hasOwn(value, 'knownAudit') ||
      (value.knownAudit === 1 &&
        value.binding.channel === 'honor' &&
        isReviewAnchor(value.reviewAnchor))) &&
    [value.identifier, value.versionName, value.buildNumber].every(
      (v) => typeof v === 'string' && v.length > 0 && v.length <= 255 && !/[\x00-\x1f]/.test(v),
    )
  )
}
