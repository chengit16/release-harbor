/** @description 项目与本地服务能力的公开访问，不处理导航或表单提示。 */
import {
  frameworks,
  isRecord,
  type CreateProject,
  type Project,
  type ProductStatus,
} from '@release-harbor/contracts'
import { item, items, json, request } from '../client.ts'

function isProject(value: unknown): value is Project {
  return (
    isRecord(value) &&
    ['id', 'workspaceId', 'name', 'key', 'description', 'createdAt'].every(
      (key) => typeof value[key] === 'string',
    ) &&
    frameworks.some((framework) => framework === value.framework)
  )
}
function status(value: unknown): ProductStatus {
  if (
    !isRecord(value) ||
    value.product !== 'release-harbor' ||
    value.mode !== 'local' ||
    value.milestone !== 'foundation' ||
    value.publishingEnabled !== false ||
    typeof value.workspaceId !== 'string'
  )
    throw new Error('本地服务能力合同不匹配')
  return {
    product: value.product,
    mode: value.mode,
    milestone: value.milestone,
    publishingEnabled: value.publishingEnabled,
    workspaceId: value.workspaceId,
  }
}

/** 并行读取项目和本地能力，旧请求由调用方统一取消。 */
export async function loadWorkspace(
  signal: AbortSignal,
): Promise<{ projects: Project[]; status: ProductStatus }> {
  const [projects, health] = await Promise.all([
    request('/api/projects', items(isProject), { signal }),
    request('/api/health', status, { signal }),
  ])
  return { projects, status: health }
}

/** 创建公开项目资料，不接受客户端指定工作空间。 */
export function createProject(input: CreateProject, signal: AbortSignal): Promise<Project> {
  return request('/api/projects', item('project', isProject), json('POST', input, signal))
}
