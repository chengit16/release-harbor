/** @description 独立商店状态目录与查询请求；页面刷新读取缓存，明确操作才发起官方查询。 */
import {
  isStoreStatusResponse,
  isStoreStatusSnapshot,
  type StoreStatusResponse,
  type StoreStatusSnapshot,
  type StoreVersionQuery,
  isStoreManualRecord,
  isRecord,
  type StoreManualInput,
  type StoreManualRecord,
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

/** 明确查询官方只读接口或指定 Apple 资料；目标与版本必须匹配，不返回私人资料字段。 */
export function queryStoreStatus(
  projectId: string,
  applicationId: string,
  bindingId: string,
  signal: AbortSignal,
  query?: StoreVersionQuery,
  materialVersionId?: string,
): Promise<StoreStatusSnapshot> {
  return request(
    `/api/store-status/${encodeURIComponent(projectId)}/${encodeURIComponent(applicationId)}/${encodeURIComponent(bindingId)}/${materialVersionId ? 'materials' : 'query'}`,
    (value) => {
      if (
        !isRecordSnapshotResponse(value) ||
        value.snapshot.bindingId !== bindingId ||
        JSON.stringify(value.snapshot.query ?? null) !== JSON.stringify(query ?? null) ||
        value.snapshot.materialVersionId !== materialVersionId
      )
        throw new Error('商店状态查询响应格式不正确')
      return value.snapshot
    },
    {
      ...json(
        'POST',
        materialVersionId ? { versionId: materialVersionId } : query ? { query } : {},
        signal,
      ),
      headers: { 'Content-Type': 'application/json', 'X-Release-Harbor-Query': '1' },
    },
    175000,
  )
}

/** 人工记录明确使用独立写入口；失败重试复用 requestId，不覆盖官方缓存。 */
export function saveStoreManualRecord(
  projectId: string,
  applicationId: string,
  bindingId: string,
  input: StoreManualInput,
  signal: AbortSignal,
): Promise<StoreManualRecord> {
  return request(
    `/api/store-status/${encodeURIComponent(projectId)}/${encodeURIComponent(applicationId)}/${encodeURIComponent(bindingId)}/manual`,
    (value) => {
      if (
        !isRecord(value) ||
        !isStoreManualRecord(value.record) ||
        value.record.bindingId !== bindingId ||
        value.record.requestId !== input.requestId
      )
        throw new Error('人工核对记录响应格式不正确')
      return value.record
    },
    {
      ...json('POST', input, signal),
      headers: { 'Content-Type': 'application/json', 'X-Release-Harbor-Query': '1' },
    },
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
