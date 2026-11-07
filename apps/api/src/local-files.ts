/** @description 本机增强文件原语；只由可信启动装配指定路径，原子替换失败不覆盖旧文件。 */
import { randomUUID, createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, rm, lstat, open } from 'node:fs/promises'
import { dirname } from 'node:path'
import { DomainError } from '@release-harbor/domain'

/** 摘要用于完整性核对，不作为认证或授权。 */
export function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
/** 有界读取普通文件，拒绝符号链接与目录；缺失只在调用方明确指定时初始化。 */
export async function readLocal(path: string, limit = 32 * 1024 * 1024): Promise<string | null> {
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || info.size > limit) throw Error()
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw new DomainError('本机数据无法安全读取，请检查存储或备份', 503)
  }
}
/** 写临时文件后同步并替换；用于单进程队列内，不代替跨进程锁。 */
export async function atomicLocal(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temp = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temp, JSON.stringify(value), { mode: 0o600, flag: 'wx' })
    const file = await open(temp, 'r')
    try {
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(temp, path)
    const dir = await open(dirname(path), 'r')
    try {
      await dir.sync()
    } finally {
      await dir.close()
    }
  } finally {
    await rm(temp, { force: true })
  }
}
