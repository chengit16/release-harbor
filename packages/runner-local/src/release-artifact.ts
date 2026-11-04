/** @description 执行产物副本的生命周期；先检查原件，再复核副本，仅在本次回调中提供受控文件。 */
import { copyFile, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ArtifactIdentity, AttemptResult } from '@release-harbor/contracts'
import { inspectBoundArtifact } from './inspect.ts'
import type { InspectionTask } from './protocol.ts'

/** 临时根仅由可信宿主选择，默认系统临时目录；检查失败时不运行后续凭据解析及商店操作。 */
export async function withVerifiedReleaseArtifact(
  inspection: InspectionTask,
  identity: ArtifactIdentity,
  use: (file: string) => Promise<AttemptResult>,
  temporaryRoot = tmpdir(),
): Promise<AttemptResult> {
  // 1. 原件通过路径、字节与身份检查后才允许复制。
  const original = await inspectBoundArtifact(inspection)
  if (original.failureCode || !original.identity) return 'verification_failed'
  const created = await mkdtemp(join(temporaryRoot, 'release-harbor-execution-'))
  try {
    // macOS 的系统临时根可能经 /var 指向 /private/var；只规范化本次创建目录，
    // 继续保留安装包和子目录的严格符号链接拒绝规则，避免把可信别名误报为字节不匹配。
    const temporary = await realpath(created)
    // 2. 上传使用本次副本，避免原件在复核后被替换；严格路径检查仍由 inspect 负责。
    await mkdir(join(temporary, inspection.artifactId), { mode: 0o700 })
    const file = join(temporary, inspection.artifactId, 'payload.' + inspection.format)
    await copyFile(
      join(inspection.storageRoot, inspection.artifactId, 'payload.' + inspection.format),
      file,
    )
    const copied = await inspectBoundArtifact({ ...inspection, storageRoot: temporary })
    if (
      copied.failureCode ||
      !copied.identity ||
      copied.identity.versionName !== identity.versionName ||
      copied.identity.buildNumber !== identity.buildNumber
    )
      return 'verification_failed'
    // 3. 只在副本通过后进入后续流程；所有终态及异常均清理本次目录。
    return await use(file)
  } finally {
    await rm(created, { recursive: true, force: true }).catch(() => undefined)
  }
}
