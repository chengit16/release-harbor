/** @description 独立商店状态目录与查询请求；页面刷新读取缓存，明确操作才发起官方查询。 */
import {
  isStoreStatusResponse,
  isStoreStatusSnapshot,
  type StoreStatusResponse,
  type StoreStatusSnapshot,
} from '@release-harbor/contracts'
import { request, json } from '../client.ts'

/** 读取绑定与历史快照，不请求商店。 */
export function loadStoreStatus(signal: AbortSignal): Promise<StoreStatusResponse> {
  return request(
    '/api/store-status',
    (value) => {
      if (!isStoreStatusResponse(value)) throw new Error('商店状态目录格式不正确')
      return value
    },
    { signal, cache: 'no-store' },
  )
}

/** 明确查询官方只读接口，时间预算覆盖独立 worker；响应必须匹配当前绑定。 */
export function queryStoreStatus(
  projectId: string,
  applicationId: string,
  bindingId: string,
  signal: AbortSignal,
): Promise<StoreStatusSnapshot> {
  return request(
    `/api/store-status/${encodeURIComponent(projectId)}/${encodeURIComponent(applicationId)}/${encodeURIComponent(bindingId)}/query`,
    (value) => {
      if (!isRecordSnapshotResponse(value) || value.snapshot.bindingId !== bindingId)
        throw new Error('商店状态查询响应格式不正确')
      return value.snapshot
    },
    {
      ...json('POST', {}, signal),
      headers: { 'Content-Type': 'application/json', 'X-Release-Harbor-Query': '1' },
    },
    175000,
  )
}

function isRecordSnapshotResponse(value: unknown): value is { snapshot: StoreStatusSnapshot } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'snapshot' in value &&
    isStoreStatusSnapshot(value.snapshot)
  )
}
