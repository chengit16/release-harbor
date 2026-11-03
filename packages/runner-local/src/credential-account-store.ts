/** @description 本机账号标签与保存意图存储，不含秘密；单进程串行原子写入，SDK Vault 独立维护。 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, lstat } from 'node:fs/promises'
import { writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  isCredentialOperation,
  isRecord,
  type CredentialOperation,
} from '@release-harbor/contracts'

/** 标签文件无法读取时拒绝覆盖，终态更新不改变保存意图。 */
export class CredentialAccountStore {
  private pending: Promise<unknown> = Promise.resolve()
  constructor(private readonly file: string) {}

  private async read(): Promise<CredentialOperation[]> {
    try {
      const stat = await lstat(this.file)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024)
        throw new Error('无效存储')
      const data: unknown = JSON.parse(await readFile(this.file, 'utf8'))
      if (
        !isRecord(data) ||
        Object.keys(data).length !== 2 ||
        data.schemaVersion !== 1 ||
        !Array.isArray(data.operations) ||
        !data.operations.every(isCredentialOperation) ||
        new Set(data.operations.map((o) => o.id)).size !== data.operations.length ||
        new Set(data.operations.map((o) => o.reference)).size !== data.operations.length
      )
        throw new Error('无效存储')
      return data.operations
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
      throw new Error('账号记录无法读取，请检查存储或从备份恢复')
    }
  }

  /** 查询等候本进程中的上一次写入，不把暂存状态发布成最终保存事实。 */
  async list(): Promise<CredentialOperation[]> {
    await this.pending
    return this.read()
  }

  /** 保存前登记稳定 reference，完成后只能更新状态，不能改动归属或名称。 */
  save(operation: CredentialOperation): Promise<void> {
    const result = this.pending.then(async () => {
      // 1. 同一写队列内检查身份与旧状态，终态不能被迟到回报改写。
      if (!isCredentialOperation(operation)) throw new Error('无效操作')
      const operations = await this.read()
      const previous = operations.find((item) => item.id === operation.id)
      if (
        previous &&
        (previous.reference !== operation.reference ||
          previous.channel !== operation.channel ||
          previous.displayName !== operation.displayName ||
          previous.createdAt !== operation.createdAt ||
          !['saving', 'needs_reconciliation'].includes(previous.status))
      )
        throw new Error('不能覆盖已结束的保存操作')
      if (
        !previous &&
        // 2. 名称和引用唯一性与写入共用队列，不能仅依赖页面查重。
        (operation.status !== 'saving' ||
          operations.some(
            (o) =>
              o.reference === operation.reference ||
              (o.channel === operation.channel &&
                o.displayName === operation.displayName &&
                o.status !== 'failed'),
          ))
      )
        throw new Error('账号名称已被使用')
      const next = previous
        ? operations.map((o) => (o.id === operation.id ? operation : o))
        : [...operations, operation]
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 })
      // 3. 只原子替换安全意图文件；SDK 材料文件仍由独立存储边界管理。
      const temporary = this.file + '.' + randomUUID() + '.tmp'
      try {
        await writeFile(
          temporary,
          JSON.stringify({ schemaVersion: 1, operations: next }, null, 2),
          { flag: 'wx', mode: 0o600 },
        )
        await rename(temporary, this.file)
      } finally {
        await rm(temporary, { force: true })
      }
    })
    // 队列保留后续查询能力，但本次失败仍明确返回给调用方。
    this.pending = result.catch(() => undefined)
    return result
  }
}
