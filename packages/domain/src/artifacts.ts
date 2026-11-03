/** @description 产物输入和身份匹配规则，不读写文件、不依赖上传框架或 SDK。 */
import type { Application, ArtifactIdentity } from '@release-harbor/contracts'
import { artifactLimits } from '@release-harbor/contracts'
import { DomainError } from './errors.ts'

/** 安全显示名与平台格式校验；文件名绝不能被当作执行路径。 */
export function validateArtifactInput(
  application: Pick<Application, 'platform'>,
  fileName: unknown,
  size: unknown,
): {
  fileName: string
  format: 'apk' | 'ipa'
  expectedSizeBytes: number
} {
  if (
    typeof fileName !== 'string' ||
    fileName.length < 1 ||
    fileName.length > 120 ||
    fileName !== fileName.trim() ||
    /[\/\\\x00-\x1f\x7f]/.test(fileName) ||
    fileName.startsWith('.')
  )
    throw new DomainError('文件名无效，仅接受不含路径和控制字符的 APK／IPA 名称')
  const format = fileName.toLowerCase().endsWith('.apk')
    ? 'apk'
    : fileName.toLowerCase().endsWith('.ipa')
      ? 'ipa'
      : null
  if (!format || (application.platform === 'android' ? format !== 'apk' : format !== 'ipa'))
    throw new DomainError('安装包格式与当前应用平台不匹配，请选择 APK 或 IPA')
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 1)
    throw new DomainError('安装包不能为空，且必须声明有效字节数')
  if (size > artifactLimits.maxFileBytes)
    throw new DomainError('安装包超过单文件 256 MiB 限制', 413)
  return { fileName, format, expectedSizeBytes: size }
}

/** 只有实际字节身份与应用完全一致才可供后续计划选用，不判断签名或商店受理。 */
export function artifactMatchesApplication(
  application: Application,
  identity: ArtifactIdentity,
): boolean {
  return (
    identity.packageName === application.identifier &&
    identity.format === (application.platform === 'android' ? 'apk' : 'ipa')
  )
}
