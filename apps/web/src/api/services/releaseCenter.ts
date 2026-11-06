/** @description 发布中心同源只读查询，严格验证安全摘要；不自动触发预检、确认或执行。 */
import { isReleaseCenterResponse, type ReleaseCenterResponse } from '@release-harbor/contracts'
import { request } from '../client.ts'

/** 单次请求聚合当前本机工作空间，取消和错误沿用公共 Client。 */
export function loadReleaseCenter(signal: AbortSignal): Promise<ReleaseCenterResponse> {
  return request(
    '/api/release-center',
    (value) => {
      if (!isReleaseCenterResponse(value)) throw new Error('发布中心响应格式不正确')
      return value
    },
    { signal, cache: 'no-store' },
  )
}
