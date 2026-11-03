import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DomainError, type ProjectStore } from '@release-harbor/domain'
import type { Project } from '@release-harbor/contracts'

/** 本地单进程存储；线上多实例必须替换为有唯一约束和事务的数据库实现。 */
export class FileProjectStore implements ProjectStore {
  private pending: Promise<unknown> = Promise.resolve()
  constructor(private readonly file: string) {}
  private async read(): Promise<Project[]> {
    try {
      const data: unknown = JSON.parse(await readFile(this.file, 'utf8'))
      if (
        !Array.isArray(data) ||
        !data.every(
          (p) =>
            typeof p.id === 'string' &&
            typeof p.workspaceId === 'string' &&
            typeof p.key === 'string' &&
            typeof p.name === 'string',
        )
      )
        throw new Error('invalid store')
      return data as Project[]
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      // 损坏文件不能被空列表覆盖，否则创建项目时可能吞掉已有记录。
      throw new DomainError('项目数据无法读取，请检查存储文件或从备份恢复', 500)
    }
  }
  async list(workspaceId: string) {
    await this.pending
    return (await this.read())
      .filter((p) => p.workspaceId === workspaceId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  async get(workspaceId: string, id: string) {
    return (await this.list(workspaceId)).find((p) => p.id === id)
  }
  create(project: Project): Promise<Project> {
    const operation = this.pending.then(async () => {
      const projects = await this.read()
      if (projects.some((p) => p.workspaceId === project.workspaceId && p.key === project.key))
        throw new DomainError('当前工作空间已存在相同项目标识', 409)
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 })
      const temporary = this.file + '.' + randomUUID() + '.tmp'
      // 同目录原子替换与串行写入共同避免半文件和并发创建丢记录。
      await writeFile(temporary, JSON.stringify([...projects, project], null, 2), { mode: 0o600 })
      await rename(temporary, this.file)
      return project
    })
    this.pending = operation.catch(() => undefined)
    return operation
  }
}
