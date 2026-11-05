/** @description 正式鸿蒙 APP 的有界 ZIP 身份检查；只读 pack.info，不解压文件或接受调试 HAP。 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { isRecord, isStoreVersionCode, type ArtifactIdentity } from '@release-harbor/contracts'

/** 解析必需字段不使用默认版本；唯一根 pack.info 与实际 SHA／大小共同构成产物身份。 */
export async function inspectHarmonyArtifact(file: string): Promise<ArtifactIdentity> {
  const run = promisify(execFile),
    { stdout: list } = await run('/usr/bin/unzip', ['-Z1', file], {
      encoding: 'utf8',
      timeout: 15000,
      maxBuffer: 4 * 1024 * 1024,
    })
  if (list.split('\n').filter((x) => x === 'pack.info').length !== 1)
    throw new Error('正式 APP 缺少唯一 pack.info')
  const { stdout } = await run('/usr/bin/unzip', ['-p', file, 'pack.info'], {
    encoding: 'utf8',
    timeout: 15000,
    maxBuffer: 1024 * 1024,
  })
  const pack: unknown = JSON.parse(stdout)
  if (!isRecord(pack) || !isRecord(pack.summary) || !isRecord(pack.summary.app))
    throw new Error('APP 身份结构无效')
  const app = pack.summary.app,
    v = app.version,
    code = isRecord(v) ? v.code : undefined,
    buildNumber = typeof code === 'number' && Number.isSafeInteger(code) ? String(code) : code
  if (
    typeof app.bundleName !== 'string' ||
    app.bundleName.length > 255 ||
    !/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(app.bundleName) ||
    !isRecord(v) ||
    typeof v.name !== 'string' ||
    !v.name.trim() ||
    v.name.length > 100 ||
    /[\x00-\x1f\x7f]/.test(v.name) ||
    !isStoreVersionCode(buildNumber)
  )
    throw new Error('APP 包名或版本无效')
  const hash = createHash('sha256')
  let sizeBytes = 0
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk)
    sizeBytes += chunk.length
  }
  return {
    format: 'app',
    packageName: app.bundleName,
    versionName: v.name,
    buildNumber,
    sizeBytes,
    sha256: hash.digest('hex'),
  }
}
