/** @description 使用本机 Android SDK 生成仅含 Manifest 的合成 APK，不包含业务代码或生产签名。 */
import { execFile } from 'node:child_process'
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

/** 工具缺失返回 null，由调用方如实跳过；禁止用伪造 aapt 输出替代实际包解析。 */
export async function syntheticApk(root: string): Promise<Buffer | null> {
  const sdk =
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    join(homedir(), 'Library/Android/sdk')
  const versions = (await readdir(join(sdk, 'build-tools')).catch(() => [])).sort((a, b) =>
    b.localeCompare(a, undefined, { numeric: true }),
  )
  const platforms = (await readdir(join(sdk, 'platforms')).catch(() => [])).sort((a, b) =>
    b.localeCompare(a, undefined, { numeric: true }),
  )
  if (!versions[0] || !platforms[0]) return null
  const tool = join(sdk, 'build-tools', versions[0], 'aapt2')
  const jar = join(sdk, 'platforms', platforms[0], 'android.jar')
  if (
    !(await Promise.all([access(tool), access(jar)]).then(
      () => true,
      () => false,
    ))
  )
    return null
  const directory = join(root, 'synthetic-apk')
  await mkdir(directory)
  const manifest = join(directory, 'AndroidManifest.xml')
  await writeFile(
    manifest,
    `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example.android" android:versionCode="7" android:versionName="0.1.0">
<uses-sdk android:minSdkVersion="23" android:targetSdkVersion="35"/><application android:label="合成测试"/></manifest>`,
  )
  const output = join(directory, 'synthetic.apk')
  await promisify(execFile)(tool, ['link', '--manifest', manifest, '-I', jar, '-o', output], {
    timeout: 15000,
  })
  return readFile(output)
}
