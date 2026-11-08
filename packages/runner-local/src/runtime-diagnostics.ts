/** @description 固定本机工具可执行性检查；不运行任意命令、不解析凭据、不请求商店。 */
import { access, readdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { delimiter, join } from 'node:path'
import { homedir } from 'node:os'
import type { RuntimeCheck } from '@release-harbor/contracts'
/** 仅报告就绪与缺失，不返回用户目录或工具原始输出；实际解析在独立检查时完成。 */
export async function runtimeTools(): Promise<RuntimeCheck[]> {
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  // 与实际检查器保持同一 SDK 根优先级，避免次要目录存在工具却错误报告就绪。
  const root =
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    join(homedir(), 'Library/Android/sdk')
  const build = join(root, 'build-tools')
  const apkDirs = [...dirs]
  for (const version of await readdir(build).catch(() => [])) apkDirs.push(join(build, version))
  async function available(name: string, candidates = dirs): Promise<boolean> {
    for (const dir of candidates)
      if (
        await access(join(dir, name), constants.X_OK).then(
          () => true,
          () => false,
        )
      )
        return true
    return false
  }
  const apk = (await available('aapt2', apkDirs)) || (await available('aapt', apkDirs))
  const unzip = await available('unzip'),
    plutil = await available('plutil')
  return [
    {
      key: 'apk-tool',
      label: 'APK 检查工具',
      state: apk ? 'ready' : 'unavailable',
      detail: apk
        ? '已找到可执行 aapt/aapt2；实际包检查仍须导入后执行。'
        : '未找到 aapt/aapt2，请安装 Android SDK Build Tools 后重启服务。',
    },
    {
      key: 'ipa-tool',
      label: 'IPA 检查工具',
      state: unzip && plutil ? 'ready' : 'unavailable',
      detail:
        unzip && plutil
          ? '已找到 unzip 与 plutil；不代表 Apple 上传工具或商店权限可用。'
          : '缺少 unzip 或 plutil，请在 macOS 安装相应工具后重启服务。',
    },
    {
      key: 'harmony-tool',
      label: '鸿蒙 APP 检查工具',
      state: unzip ? 'ready' : 'unavailable',
      detail: unzip
        ? '已找到 unzip，正式 APP 身份仍需导入检查。'
        : '缺少 unzip，请安装后重启服务。',
    },
  ]
}
