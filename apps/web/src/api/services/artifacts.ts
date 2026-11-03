/** @description 产物公开查询与原始字节上传，路径和摘要均由可信服务端生成。 */
import { artifactLimits, isArtifactRecord, type ArtifactRecord } from '@release-harbor/contracts'
import { item, items, request } from '../client.ts'

function root(projectId: string, applicationId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/applications/${encodeURIComponent(applicationId)}/artifacts`
}

/** 记录来源于服务端，不把选中文件当作上传或检查成功。 */
export function listArtifacts(
  projectId: string,
  applicationId: string,
  signal: AbortSignal,
): Promise<ArtifactRecord[]> {
  return request(root(projectId, applicationId), items(isArtifactRecord), { signal })
}

/** 显式发送文件实际字节；202 仅表示接收完毕，后续必须查询检查结果。 */
export function uploadArtifact(
  projectId: string,
  applicationId: string,
  file: File,
  signal: AbortSignal,
): Promise<ArtifactRecord> {
  return request(
    root(projectId, applicationId),
    item('artifact', isArtifactRecord),
    {
      method: 'POST',
      body: file,
      signal,
      headers: {
        'Content-Type': 'application/octet-stream',
        'x-artifact-name': encodeURIComponent(file.name),
        'x-artifact-size': String(file.size),
      },
    },
    artifactLimits.uploadTimeoutMs + 5000,
  )
}
