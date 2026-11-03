/**
 * @description IPA 二进制 plist 兼容检查
 * 锁定 SDK 0.3.0 的 IPA 分支会将原始 plist 当 UTF-8 文本传递；此处保留原始字节，
 * 不改写压缩包，并维持普通文件、版本、流式摘要与读取期间稳定性约束。
 */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { isArtifactIdentity, isRecord, type ArtifactIdentity } from '@release-harbor/contracts'

const run = promisify(execFile)

async function convertPlist(raw: Buffer): Promise<unknown> {
  const json = await new Promise<string>((done, reject) => {
    const child = execFile(
      'plutil',
      ['-convert', 'json', '-o', '-', '-'],
      {
        encoding: 'utf8',
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout) => {
        if (error) reject(new Error('IPA 的 Info.plist 无法解析'))
        else done(stdout)
      },
    )
    // 二进制 bplist 必须直接送入 stdin；任何 toString() 往返都会损坏非 UTF-8 字节。
    child.stdin?.on('error', () => reject(new Error('IPA plist 转换进程提前结束')))
    child.stdin?.end(raw)
  })
  return JSON.parse(json)
}

/** 返回与 SDK 相同的安全身份投影，支持 XML 和二进制 plist，绝不修改用户文件。 */
export async function inspectIpaArtifact(artifactPath: string): Promise<ArtifactIdentity> {
  // 1. 只读普通文件；稳定性信息用于最后复核，不能弱化原有摘要边界。
  const file = resolve(artifactPath)
  const before = await lstat(file)
  if (!before.isFile() || before.isSymbolicLink())
    throw new Error('产物必须是普通文件，不能是符号链接')
  // 2. 只解析唯一根应用的 plist，不混入插件、扩展或多个根应用的身份。
  const { stdout: listing } = await run('unzip', ['-Z1', file], {
    encoding: 'utf8',
    timeout: 15000,
    maxBuffer: 1024 * 1024,
  })
  const entries = listing
    .split(/\r?\n/)
    .filter((entry) => /^Payload\/[^/]+\.app\/Info\.plist$/.test(entry))
  if (entries.length !== 1) throw new Error('IPA 必须包含唯一根应用 Info.plist')
  const entry = entries[0]
  if (!entry) throw new Error('IPA 缺少根应用 Info.plist')
  const { stdout: raw } = await run('unzip', ['-p', file, entry], {
    encoding: 'buffer',
    timeout: 15000,
    maxBuffer: 4 * 1024 * 1024,
  })
  const plist = await convertPlist(raw)
  if (
    !isRecord(plist) ||
    typeof plist.CFBundleIdentifier !== 'string' ||
    typeof plist.CFBundleShortVersionString !== 'string' ||
    typeof plist.CFBundleVersion !== 'string'
  )
    throw new Error('IPA 缺少可核对的 Bundle ID、版本或构建号')
  // 3. 摘要仍来自原始 IPA 字节；解析成功不意味着文件可以在读取期间被替换。
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  const after = await lstat(file)
  if (
    !after.isFile() ||
    after.isSymbolicLink() ||
    after.size !== before.size ||
    after.mtimeMs !== before.mtimeMs ||
    after.ctimeMs !== before.ctimeMs ||
    after.ino !== before.ino ||
    after.dev !== before.dev
  )
    throw new Error('读取期间 IPA 发生变化，请重新检查')
  const identity = {
    format: 'ipa',
    packageName: plist.CFBundleIdentifier.trim(),
    versionName: plist.CFBundleShortVersionString.trim(),
    buildNumber: plist.CFBundleVersion.trim(),
    sizeBytes: after.size,
    sha256: hash.digest('hex'),
  }
  if (!isArtifactIdentity(identity)) throw new Error('IPA 身份或版本字段无效')
  return identity
}
