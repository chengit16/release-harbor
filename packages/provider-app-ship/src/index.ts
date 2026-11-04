/** @description 商店 SDK 的可信 Node 适配，公开投影排除本机路径与供应商内部对象。 */
import type { ArtifactIdentity } from '@release-harbor/contracts'
import { extname } from 'node:path'
import { ArtifactInspectionUnavailableError, hasInspectionTools } from './inspection-tools.ts'
import { inspectIpaArtifact } from './inspect-ipa.ts'

export {
  credentialStore,
  profileRevision,
  profileCatalog,
  readonlyTransport,
  checkMerchant,
} from './credentials.ts'

export { ArtifactInspectionUnavailableError } from './inspection-tools.ts'
export {
  localCredentialRepository,
  validateCredentialSubmission,
  CredentialInputError,
  type CredentialRepository,
  type CredentialMaterialInput,
} from './credential-intake.ts'

/** 此适配仅可由执行器在受信任的本机进程调用，不能把任意路径检查暴露为远程 HTTP 接口。 */
export async function inspectLocalArtifact(absolutePath: string): Promise<ArtifactIdentity> {
  if (!(await hasInspectionTools(extname(absolutePath).slice(1).toLowerCase())))
    throw new ArtifactInspectionUnavailableError('缺少安装包检查工具')
  // SDK 0.3.0 的 IPA plist 文本转换会破坏二进制内容，兼容实现仅集中在此适配边界。
  if (extname(absolutePath).toLowerCase() === '.ipa') return inspectIpaArtifact(absolutePath)
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
/** 静态适配版本信息，不表示真实发布功能已开放。 */
export const providerInfo = {
  name: '@huoye/app-ship',
  version: '0.3.0',
  executionEnabled: false,
} as const
export { saveHuaweiDraft } from './release-execution.ts'
export { submitXiaomiUpdate, checkXiaomiUpdate } from './xiaomi-updates.ts'

export { loadXiaomiListing } from './xiaomi-listing.ts'

export { submitOppoUpdate } from './oppo-updates.ts'
