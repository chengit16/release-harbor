/** @description 在线安装包 PostgreSQL 投影；查询和状态变更始终带完整应用归属。 */
import type { Pool } from 'pg'
import type { HostedArtifact, HostedArtifactStatus } from '@release-harbor/contracts'
import { hostedArtifactLimits } from '@release-harbor/contracts'
import { DomainError } from '@release-harbor/domain'
import { hostedId } from '../identity.ts'
import type { HostedScope } from '../session-store.ts'

/** 在线接收的内部记录，不通过 HTTP 直接返回。 */
export interface HostedArtifactRow {
  id: string
  fileName: string
  sizeBytes: number
  status: HostedArtifactStatus
  createdAt: Date
  expiresAt: Date
  receivedAt: Date | null
  secondsLeft: number
  manifest: string[]
  objectKey: string
  uploadId: string
  objectVersion: string | null
}

/** 当前可信空间事务内的应用归属。 */
export interface HostedArtifactScope extends HostedScope {
  projectId: string
  applicationId: string
}

/** 创建时由服务端验证的输入，requestId 只用于重复确认去重。 */
export interface HostedIntakeInput {
  requestId: string
  fileName: string
  sizeBytes: number
  manifest: string[]
}

const fields = `id, file_name AS "fileName", size_bytes AS "sizeBytes", status,
  created_at AS "createdAt", expires_at AS "expiresAt", received_at AS "receivedAt",
  floor(extract(epoch FROM (expires_at - clock_timestamp())))::integer AS "secondsLeft",
  manifest, object_key AS "objectKey", upload_id AS "uploadId", object_version AS "objectVersion"`
const belongs = 'workspace_id = $1 AND project_id = $2 AND application_id = $3'

/** 只投影可展示事实；内部对象位置、期限能力和清单不进入列表。 */
export function hostedArtifactView(row: HostedArtifactRow): HostedArtifact {
  return {
    id: row.id,
    fileName: row.fileName,
    sizeBytes: row.sizeBytes,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  }
}

function owner(scope: HostedArtifactScope): string[] {
  return [scope.workspaceId, scope.projectId, scope.applicationId]
}

/** 查询当前空间保留的接收字节；必须在空间写锁下预留新增配额。 */
export async function reservedArtifactBytes(scope: HostedArtifactScope): Promise<number> {
  const result = await scope.client.query<{ total: number }>(
    `SELECT COALESCE(sum(size_bytes), 0)::double precision AS total FROM rh_hosted.artifacts
     WHERE workspace_id = $1 AND status IN ('receiving', 'awaiting_check')`,
    [scope.workspaceId],
  )
  return result.rows[0]?.total ?? 0
}

/** 按归属列出有界记录，不访问对象存储。 */
export async function listHostedArtifacts(scope: HostedArtifactScope): Promise<HostedArtifact[]> {
  const result = await scope.client.query<HostedArtifactRow>(
    `SELECT ${fields} FROM rh_hosted.artifacts WHERE ${belongs} ORDER BY created_at DESC, id LIMIT 100`,
    owner(scope),
  )
  return result.rows.map(hostedArtifactView)
}

/** 读取本应用指定记录；其他空间和父级统一返回不存在。 */
export async function hostedArtifactRow(
  scope: HostedArtifactScope,
  id: string,
): Promise<HostedArtifactRow> {
  const result = await scope.client.query<HostedArtifactRow>(
    `SELECT ${fields} FROM rh_hosted.artifacts WHERE ${belongs} AND id = $4`,
    [...owner(scope), hostedId(id)],
  )
  if (!result.rows[0]) throw new DomainError('安装包记录不存在', 404)
  return result.rows[0]
}

/** 仅在完整归属内识别同一创建请求；客户端不能借请求 ID 跨应用复用。 */
export async function byUploadRequest(
  scope: HostedArtifactScope,
  requestId: string,
): Promise<HostedArtifactRow | undefined> {
  const result = await scope.client.query<HostedArtifactRow>(
    `SELECT ${fields} FROM rh_hosted.artifacts WHERE ${belongs} AND request_id = $4`,
    [...owner(scope), requestId],
  )
  return result.rows[0]
}

/** 保存接收记录、清单和保留大小，完成之前不设置对象版本。 */
export async function insertHostedArtifact(
  scope: HostedArtifactScope,
  input: HostedIntakeInput,
  id: string,
  key: string,
  uploadId: string,
): Promise<HostedArtifact> {
  const result = await scope.client.query<HostedArtifactRow>(
    `INSERT INTO rh_hosted.artifacts
       (workspace_id, project_id, application_id, id, request_id, file_name, size_bytes, manifest,
        object_key, upload_id, status, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'receiving',clock_timestamp() + $11 * interval '1 second')
     RETURNING ${fields}`,
    [
      ...owner(scope),
      id,
      input.requestId,
      input.fileName,
      input.sizeBytes,
      input.manifest,
      key,
      uploadId,
      hostedArtifactLimits.uploadSeconds,
    ],
  )
  return requiredView(result.rows[0])
}

/** 完成后持久化固定版本与接收时间；不追加包身份或可信整包摘要。 */
export async function freezeHostedArtifact(
  scope: HostedArtifactScope,
  id: string,
  version: string,
): Promise<HostedArtifact> {
  const result = await scope.client.query<HostedArtifactRow>(
    `UPDATE rh_hosted.artifacts SET status = 'awaiting_check', object_version = $5, received_at = clock_timestamp()
     WHERE ${belongs} AND id = $4 AND status = 'receiving' RETURNING ${fields}`,
    [...owner(scope), id, version],
  )
  return requiredView(result.rows[0])
}

/** 仅在远端操作确定后释放配额；元数据与完成事实留存。 */
export async function retireHostedArtifact(
  scope: HostedArtifactScope,
  id: string,
  status: 'cancelled' | 'removed',
): Promise<HostedArtifact> {
  const result = await scope.client.query<HostedArtifactRow>(
    `UPDATE rh_hosted.artifacts SET status = $5 WHERE ${belongs} AND id = $4 AND status = $6
     RETURNING ${fields}`,
    [...owner(scope), id, status, status === 'cancelled' ? 'receiving' : 'awaiting_check'],
  )
  return requiredView(result.rows[0])
}

/** 读取可信引用保护；调用者持有同一空间锁。 */
export async function artifactHasHold(scope: HostedArtifactScope, id: string): Promise<boolean> {
  const result = await scope.client.query(
    `SELECT 1 FROM rh_hosted.artifact_holds WHERE ${belongs} AND artifact_id = $4 LIMIT 1`,
    [...owner(scope), id],
  )
  return Boolean(result.rowCount)
}

/** 回收程序选择的可信内部位置，不来自 HTTP 输入。 */
export type ArtifactCandidate = Omit<HostedArtifactScope, 'client'> & { id: string }

/** 查找有界回收候选；实际回收时在空间锁下重验。 */
export async function expiredArtifactCandidates(pool: Pool): Promise<ArtifactCandidate[]> {
  const result = await pool.query<ArtifactCandidate>(
    `SELECT a.workspace_id AS "workspaceId", a.project_id AS "projectId",
       a.application_id AS "applicationId", a.id
     FROM rh_hosted.artifacts a
     WHERE (a.status = 'receiving' AND a.expires_at <= clock_timestamp())
        OR (a.status = 'awaiting_check' AND a.received_at <= clock_timestamp() - $1 * interval '1 second'
        AND NOT EXISTS (SELECT 1 FROM rh_hosted.artifact_holds h WHERE
          (h.workspace_id, h.project_id, h.application_id, h.artifact_id) =
          (a.workspace_id, a.project_id, a.application_id, a.id)))
     ORDER BY COALESCE(a.received_at, a.expires_at), a.id LIMIT 32`,
    [hostedArtifactLimits.retentionSeconds],
  )
  return result.rows
}

function requiredView(row: HostedArtifactRow | undefined): HostedArtifact {
  if (!row) throw new Error('数据库未返回在线安装包记录')
  return hostedArtifactView(row)
}
