/** @description 锁定 SDK 的检查工具探测，路径策略集中在适配包，避免宿主复制供应商约束。 */
import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, readdir } from 'node:fs/promises'
import { join } from 'node:path'

/** 缺少工具与损坏包分别投影，不能仅根据 SDK 通用错误里的 aapt 提示判断。 */
export class ArtifactInspectionUnavailableError extends Error {}

async function commandExists(name: string): Promise<boolean> {
  return new Promise((resolve) =>
    execFile('which', [name], { timeout: 3000 }, (error) => resolve(!error)),
  )
}

/** 只读检查工具是否存在，不访问商店、凭据或签名材料。 */
export async function hasInspectionTools(format: string): Promise<boolean> {
  if (format === 'app') return commandExists('unzip')
  if (format === 'ipa') return (await commandExists('unzip')) && (await commandExists('plutil'))
  if (format !== 'apk') return false
  if ((await commandExists('aapt2')) || (await commandExists('aapt'))) return true
  const root =
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    join(process.env.HOME || '', 'Library/Android/sdk')
  const directory = join(root, 'build-tools')
  const versions = await readdir(directory).catch(() => [])
  for (const version of versions) {
    for (const tool of ['aapt2', 'aapt']) {
      if (
        await access(join(directory, version, tool), constants.X_OK).then(
          () => true,
          () => false,
        )
      )
        return true
    }
  }
  return false
}
