/** @description 问题档案只读请求，严格解码完整目录，不接触本机路径、秘密或商店 SDK。 */
import { isIssueCatalog, type IssueCatalog } from '@release-harbor/contracts'
import { request } from '../client.ts'
/** 失败不降级为空目录，页面保留明确错误及重新读取入口。 */
export function fetchIssues(signal?: AbortSignal): Promise<IssueCatalog> {
  return request(
    '/api/issues',
    (value) => {
      if (!isIssueCatalog(value)) throw new Error('问题档案响应格式不正确')
      return value
    },
    { signal },
  )
}
