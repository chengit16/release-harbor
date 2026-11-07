/** @description 本机设置公开接口；备份字节仅由显式下载／导入操作临时持有，不持久化浏览器。 */
import {
  isRecoveryProtection,
  type RecoveryProtection,
  isLocalEfficiencyView,
  isLocalBackup,
  isRestorePreview,
  isLocalFollow,
  isRecord,
  type LocalEfficiencyView,
  type LocalFollow,
  type LocalBackup,
  type RestorePreview,
} from '@release-harbor/contracts'
import { request, item, items, json } from '../client.ts'
const write = (body: unknown) => ({
  ...json('POST', body),
  headers: { 'Content-Type': 'application/json', 'X-Release-Harbor-Local': '1' },
})
const ok = (value: unknown): void => {
  if (!isRecord(value) || value.ok !== true) throw new Error('本机操作响应不正确')
}
/** 刷新只读取设置和历史，取消不影响已提交的后台操作。 */
export function readLocalEfficiency(signal?: AbortSignal): Promise<LocalEfficiencyView> {
  return request(
    '/api/local',
    (v) => {
      if (!isLocalEfficiencyView(v)) throw Error('本机设置格式不正确')
      return v
    },
    { signal, cache: 'no-store' },
  )
}
/** 明确保存设置，服务器不代替浏览器申请通知权限。 */
export function saveLocalSettings(settings: {
  autoBackup: boolean
  browserNotifications: boolean
  showApplicationName: boolean
}): Promise<void> {
  return request('/api/local/settings', ok, write(settings))
}
/** 备份等待有界维护操作，失败不能显示成功。 */
export function createLocalBackup(): Promise<LocalBackup> {
  return request('/api/local/backups', item('backup', isLocalBackup), write({}), 120000)
}
/** 下载业务数据容器，调用方生成短期下载 URL 后立即回收。 */
export function downloadLocalBackup(id: string): Promise<string> {
  return request(
    `/api/local/backups/${encodeURIComponent(id)}`,
    (v) => {
      if (!isRecord(v) || typeof v.backup !== 'string') throw Error('备份响应无效')
      return v.backup
    },
    undefined,
    120000,
  )
}
/** 导入先校验并返回预览，不立即覆盖业务数据。 */
export function previewLocalRestore(backup: string): Promise<RestorePreview> {
  return request(
    '/api/local/restore-preview',
    item('preview', isRestorePreview),
    write({ backup }),
    120000,
  )
}
/** 恢复确认精确绑定预览摘要；成功后宿主重建服务，页面只刷新数据。 */
export function confirmLocalRestore(preview: RestorePreview): Promise<void> {
  return request(
    '/api/local/restore',
    ok,
    write({ id: preview.id, digest: preview.digest, acknowledged: true }),
    120000,
  )
}
/** 用户选择确定范围开启只读跟踪，指纹由服务端恢复。 */
export function startLocalFollow(
  input: Pick<
    LocalFollow,
    | 'projectId'
    | 'applicationId'
    | 'bindingId'
    | 'versionId'
    | 'buildNumber'
    | 'intervalMinutes'
    | 'until'
  >,
): Promise<LocalFollow> {
  return request('/api/local/follows', item('follow', isLocalFollow), write(input))
}
/** 暂停／继续／结束不会授予发布权限。 */
export function controlLocalFollow(id: string, action: 'pause' | 'resume' | 'end'): Promise<void> {
  return request(`/api/local/follows/${encodeURIComponent(id)}`, ok, write({ action }))
}
/** 标为已读不代表对应待办已解决。 */
export function readLocalNotice(id: string): Promise<void> {
  return request(`/api/local/notices/${encodeURIComponent(id)}/read`, ok, write({}))
}

/** 恢复保护账本只返回安全摘要。 */
export function readRecoveryProtections() {
  return request('/api/local/protections', items(isRecoveryProtection))
}
/** 人工结论绑定原摘要与版本，不自动重放发布。 */
export function reconcileRecoveryProtection(
  record: RecoveryProtection,
  decision: 'present' | 'absent',
): Promise<void> {
  return request(
    '/api/local/protections/reconcile',
    ok,
    write({
      id: record.id,
      kind: record.kind,
      digest: record.digest,
      versionName: record.versionName,
      buildNumber: record.buildNumber,
      decision,
      acknowledged: true,
    }),
  )
}
