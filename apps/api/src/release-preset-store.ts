/** @description 仅保存可复用发布配置；单进程原子写入，损坏拒写，不保存产物和授权。 */
import { randomUUID } from 'node:crypto'
import { DomainError } from '@release-harbor/domain'
import {
  isRecord,
  hasExactKeys,
  isReleasePreset,
  type ReleasePreset,
} from '@release-harbor/contracts'
import { atomicLocal, readLocal } from './local-files.ts'
/** 模板数量有界；所有变更复用同一写队列。 */
export class ReleasePresetStore {
  private pending: Promise<unknown> = Promise.resolve()
  constructor(private readonly path: string) {}
  /** 旧备份不含模板时视为空，不迁移旧文件。 */
  async list(): Promise<ReleasePreset[]> {
    await this.pending
    return this.read()
  }
  private async read(): Promise<ReleasePreset[]> {
    const raw = await readLocal(this.path)
    if (raw === null) return []
    const v: unknown = JSON.parse(raw)
    if (
      !isRecord(v) ||
      !hasExactKeys(v, ['schemaVersion', 'items']) ||
      v.schemaVersion !== 1 ||
      !Array.isArray(v.items) ||
      v.items.length > 100 ||
      !v.items.every(isReleasePreset) ||
      v.items.some((p) => p.source !== 'template') ||
      new Set(v.items.map((p) => p.id)).size !== v.items.length
    )
      throw new DomainError('发布模板存储损坏，请保留数据并检查备份', 503)
    return v.items
  }
  private change(action: (items: ReleasePreset[]) => void): Promise<void> {
    const operation = this.pending.then(async () => {
      const items = await this.read()
      action(items)
      await atomicLocal(this.path, { schemaVersion: 1, items })
    })
    this.pending = operation.catch(() => undefined)
    return operation
  }
  /** 每次保存为独立模板，不按同名覆盖用户配置。 */
  async add(input: Omit<ReleasePreset, 'id' | 'source' | 'createdAt'>): Promise<void> {
    const preset = {
      ...input,
      id: randomUUID(),
      source: 'template',
      createdAt: new Date().toISOString(),
    }
    if (!isReleasePreset(preset)) throw new DomainError('发布模板格式无效', 400)
    await this.change((items) => {
      if (items.length >= 100)
        throw new DomainError('最多保存一百份模板，请先删除不再使用的模板', 409)
      items.unshift(preset)
    })
  }
  /** 按完整应用归属删除，历史来源不在模板文件中。 */
  remove(projectId: string, applicationId: string, id: string): Promise<void> {
    return this.change((items) => {
      const index = items.findIndex(
        (p) => p.id === id && p.projectId === projectId && p.applicationId === applicationId,
      )
      if (index < 0) throw new DomainError('模板不存在', 404)
      items.splice(index, 1)
    })
  }
}
