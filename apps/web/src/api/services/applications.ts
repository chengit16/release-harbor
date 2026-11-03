/** @description 应用与绑定的公开接口，所有资源定位编码后进入同源路径。 */
import {
  isApplication,
  isChannelBinding,
  type Application,
  type ChannelBinding,
  type CreateApplication,
  type CreateChannelBinding,
  type UpdateChannelBinding,
} from '@release-harbor/contracts'
import { item, items, json, request } from '../client.ts'

function root(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/applications`
}
function bindingRoot(projectId: string, applicationId: string): string {
  return `${root(projectId)}/${encodeURIComponent(applicationId)}/bindings`
}

/** 获取项目下应用，归属最终由服务端验证。 */
export function listApplications(projectId: string, signal: AbortSignal): Promise<Application[]> {
  return request(root(projectId), items(isApplication), { signal })
}
/** 创建独立平台身份；不修改商店资料。 */
export function createApplication(
  projectId: string,
  input: CreateApplication,
  signal: AbortSignal,
): Promise<Application> {
  return request(root(projectId), item('application', isApplication), json('POST', input, signal))
}
/** 读取未预检的配置，不把列表成功当作凭据有效。 */
export function listBindings(
  projectId: string,
  applicationId: string,
  signal: AbortSignal,
): Promise<ChannelBinding[]> {
  return request(bindingRoot(projectId, applicationId), items(isChannelBinding), { signal })
}
/** 新建商店目标与公开凭据别名。 */
export function createBinding(
  projectId: string,
  applicationId: string,
  input: CreateChannelBinding,
  signal: AbortSignal,
): Promise<ChannelBinding> {
  return request(
    bindingRoot(projectId, applicationId),
    item('binding', isChannelBinding),
    json('POST', input, signal),
  )
}
/** 原子比较旧版本；冲突由页面保留草稿并引导核对。 */
export function updateBinding(
  projectId: string,
  applicationId: string,
  id: string,
  input: UpdateChannelBinding,
  signal: AbortSignal,
): Promise<ChannelBinding> {
  return request(
    `${bindingRoot(projectId, applicationId)}/${encodeURIComponent(id)}`,
    item('binding', isChannelBinding),
    json('PUT', input, signal),
  )
}
