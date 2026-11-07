/** @description 渠道秒级定时时间转换；向后取整以保证不早于不可变计划里的 UTC 时刻，不负责调度或授权。 */

/** 秒级接口使用向后取整的 Unix 秒，避免丢弃毫秒导致提前上架。输入来自已经验证的计划。 */
export function releaseEpochSeconds(notBefore: string): number {
  const instant = Date.parse(notBefore)
  if (!Number.isFinite(instant)) throw new Error('invalid_release_time')
  return Math.ceil(instant / 1000)
}

/** 华为与荣耀使用明确 UTC 偏移；秒级精度不改变计划原值或摘要。 */
export function releaseUtcTime(notBefore: string): string {
  return new Date(releaseEpochSeconds(notBefore) * 1000).toISOString().replace(/\.\d{3}Z$/, '+0000')
}

/** 国内 OPPO／vivo 网关按 Asia/Shanghai 发送无时区文本；官方未明确时区，仍需后台核验。 */
export function releaseChinaTime(notBefore: string): string {
  return new Date(releaseEpochSeconds(notBefore) * 1000 + 8 * 3600000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ')
}
