/** @description 用 URL 保存项目、应用及页签定位，前后退同步选择；定位不构成身份或执行授权。 */
import { updateUrlState, useUrlState } from '../../app/useUrlState.ts'

/** 仅允许已实现的应用页签，未知 URL 值回到商店绑定。 */
export type ApplicationTab = 'bindings' | 'artifacts' | 'preflight'

/** 工作台公开定位与导航，页面状态不复制到本地持久缓存。 */
export interface WorkspaceNavigation {
  /** 当前项目定位，不存在时由页面明确报错。 */
  projectId: string
  /** 为空时展示项目内应用列表。 */
  applicationId: string
  /** 由受限 URL 参数恢复，不能自动触发业务动作。 */
  tab: ApplicationTab
  /** 切换应用默认回到绑定页，只有明确切换页签时传入第三个参数。 */
  select: (projectId?: string, applicationId?: string, tab?: ApplicationTab) => void
}

function read(params: URLSearchParams) {
  const candidate = params.get('tab')
  const tab: ApplicationTab =
    candidate === 'artifacts' || candidate === 'preflight' ? candidate : 'bindings'
  return {
    projectId: params.get('project') ?? '',
    applicationId: params.get('application') ?? '',
    tab,
  }
}

/** URL 是导航事实源；只有用户选择才 pushState，浏览器后退不重新压入历史。 */
export function useSelection(): WorkspaceNavigation {
  const selection = read(useUrlState())
  function select(projectId = '', applicationId = '', tab: ApplicationTab = 'bindings'): void {
    // 全局导航与应用选择共享订阅，跨菜单进入时也能立即恢复正确项目。
    updateUrlState({
      view: 'projects',
      applicationSetup: '',
      project: projectId,
      application: projectId ? applicationId : '',
      tab: projectId && applicationId && tab !== 'bindings' ? tab : '',
    })
    window.scrollTo({ top: 0 })
  }
  return { ...selection, select }
}
