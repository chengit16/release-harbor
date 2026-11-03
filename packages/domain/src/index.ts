import { randomUUID } from 'node:crypto'
import { frameworks, type CreateProject, type Project } from '@release-harbor/contracts'

export class DomainError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message)
  }
}
/** 工作空间由可信入口确定；调用方不能通过项目请求体切换租户。 */
export interface ProjectStore {
  list(workspaceId: string): Promise<Project[]>
  get(workspaceId: string, id: string): Promise<Project | undefined>
  create(project: Project): Promise<Project>
}
export function validateProject(input: unknown): CreateProject {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new DomainError('项目资料格式不正确')
  const data = input as Record<string, unknown>
  if (Object.keys(data).some((key) => !['name', 'key', 'framework', 'description'].includes(key)))
    throw new DomainError('项目资料包含不支持的字段')
  if (typeof data.name !== 'string' || !data.name.trim() || data.name.trim().length > 60)
    throw new DomainError('项目名称需为 1–60 个字符')
  if (typeof data.key !== 'string' || !/^[a-z][a-z0-9-]{1,39}$/.test(data.key))
    throw new DomainError('项目标识需为 2–40 位小写字母、数字或短横线，并以字母开头')
  if (!frameworks.includes(data.framework as CreateProject['framework']))
    throw new DomainError('请选择受支持的技术栈')
  if (
    data.description !== undefined &&
    (typeof data.description !== 'string' || data.description.length > 300)
  )
    throw new DomainError('项目说明最多 300 个字符')
  return {
    name: data.name.trim(),
    key: data.key,
    framework: data.framework as CreateProject['framework'],
    description: (data.description as string | undefined)?.trim() ?? '',
  }
}
export class ProjectCatalog {
  constructor(private readonly store: ProjectStore) {}
  list(workspaceId: string) {
    return this.store.list(workspaceId)
  }
  async get(workspaceId: string, id: string) {
    const project = await this.store.get(workspaceId, id)
    if (!project) throw new DomainError('项目不存在', 404)
    return project
  }
  create(workspaceId: string, input: unknown) {
    const data = validateProject(input)
    return this.store.create({
      ...data,
      description: data.description ?? '',
      id: randomUUID(),
      workspaceId,
      createdAt: new Date().toISOString(),
    })
  }
}
