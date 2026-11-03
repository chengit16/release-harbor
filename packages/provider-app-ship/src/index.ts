import type { ArtifactIdentity } from '@release-harbor/contracts'

/** 此适配仅可由执行器在受信任的本机进程调用，不能把任意路径检查暴露为远程 HTTP 接口。 */
export async function inspectLocalArtifact(absolutePath: string): Promise<ArtifactIdentity> {
  const { inspectReleaseArtifact } = await import('@huoye/app-ship')
  const artifact = await inspectReleaseArtifact(absolutePath)
  // 本地路径留在执行器；控制面只接收身份和摘要。
  return {
    format: artifact.format,
    packageName: artifact.packageName,
    versionName: artifact.versionName,
    buildNumber: artifact.buildNumber,
    sizeBytes: artifact.sizeBytes,
    sha256: artifact.sha256,
  }
}
export const providerInfo = {
  name: '@huoye/app-ship',
  version: '0.3.0',
  executionEnabled: false,
} as const
