/** @description 页面 URL 的归属与兼容规则；仅保留当前菜单、页签和详情使用的公开定位，不产生业务请求。 */

const views = [
  'help',
  'settings',
  'reviews',
  'releases',
  'projects',
  'issues',
  'accounts',
  'members',
  'channels',
  'roadmap',
] as const

/** 已实现的工作台菜单；历史帮助入口继续支持直接访问。 */
export type WorkbenchView = (typeof views)[number]

const releaseFilters = [
  'releaseQuery',
  'releaseProject',
  'releaseApplication',
  'releaseChannel',
  'releaseKind',
  'releaseState',
  'releasePage',
  'releaseFocus',
]
const storageSuffixes = ['Search', 'Application', 'Status', 'Days', 'Page']

/** 先解析旧应用页签，避免清理参数时将旧发布深链误判为配置页面；未知菜单回到已实现入口。 */
export function resolveWorkbenchView(params: URLSearchParams): WorkbenchView {
  const candidate = params.get('view')
  const tab = params.get('tab')
  if (
    (tab === 'plans' || tab === 'apple-review') &&
    (!candidate || candidate === 'projects' || candidate === 'releases')
  )
    return 'releases'
  if (
    candidate === 'releases' &&
    params.get('project') &&
    params.get('application') &&
    (tab === 'bindings' || tab === 'artifacts' || tab === 'preflight')
  )
    return 'projects'
  return (
    views.find((view) => view === candidate) ?? (params.get('project') ? 'projects' : 'releases')
  )
}

function pageKeys(params: URLSearchParams, view: WorkbenchView): string[] {
  switch (view) {
    case 'releases':
      if (params.get('releaseTask') !== 'workspace') return releaseFilters
      return [
        'project',
        'application',
        'releaseTask',
        ...(params.get('releaseApple') === 'review'
          ? ['releaseApple', 'appleRecord']
          : params.has('releaseCompose')
            ? [
                'releaseCompose',
                ...(params.get('releaseCompose') === 'configured'
                  ? [
                      'releaseSelected',
                      ...((params.get('releaseSelected') ?? '').split(',').filter(Boolean).length >
                      1
                        ? ['batch', 'batchRevision']
                        : ['plan']),
                    ]
                  : []),
              ]
            : params.get('releaseView') === 'batch'
              ? ['releaseView', 'batch', 'batchRevision']
              : ['plan']),
      ]
    case 'projects':
      return params.has('project')
        ? [
            'project',
            'application',
            'tab',
            ...(params.get('tab') === 'artifacts'
              ? storageSuffixes.map((suffix) => `artifactStorage${suffix}`)
              : []),
          ]
        : ['applicationProject', 'applicationPage', 'applicationSetup']
    case 'members':
      return []
    case 'accounts':
      return ['accountChannel', 'accountDetail']
    case 'settings':
      return [
        'localTab',
        ...(!params.has('localTab') || params.get('localTab') === 'storage'
          ? storageSuffixes.map((suffix) => `storage${suffix}`)
          : []),
      ]
    case 'reviews':
      if (params.get('reviewMode') === 'follows')
        return ['reviewMode', 'followSearch', 'followStatus', 'followPage']
      return [
        'reviewMode',
        'reviewProject',
        'reviewApplication',
        'reviewChannel',
        ...(params.get('reviewMode') === 'history'
          ? ['reviewRecord', 'reviewState', 'reviewTodo', 'reviewPage']
          : [
              'reviewTarget',
              'storePage',
              ...(params.get('reviewMode') === 'todos' ? ['storeTodo'] : []),
            ]),
      ]
    case 'help':
    case 'issues':
    case 'channels':
    case 'roadmap':
      return [
        ...(view === 'help' ? ['helpTab'] : []),
        ...(view === 'issues' || (view === 'help' && params.get('helpTab') === 'issues')
          ? ['issue', 'issueQ', 'issueCategory', 'issueChannel', 'issueStatus', 'issuePage']
          : []),
      ]
  }
}

/** 将旧深链转换为当前定位并丢弃其他页面残留；值不用于替代服务端身份和授权校验。 */
export function normalizeWorkbenchSearch(input: URLSearchParams): URLSearchParams {
  const params = new URLSearchParams(input)
  const view = resolveWorkbenchView(params)
  const legacyTab = params.get('tab')
  // 1. 兼容入口先转换成当前工作区语义，保留原计划、批次和 Apple 记录身份。
  if (view === 'releases' && (legacyTab === 'plans' || legacyTab === 'apple-review')) {
    params.set('releaseTask', 'workspace')
    if (legacyTab === 'apple-review') params.set('releaseApple', 'review')
  }
  if (view === 'reviews' && params.has('reviewRecord')) params.set('reviewMode', 'history')

  // 2. 默认状态省略；只枚举当前实际使用的字段，未知字段和跨页筛选不会继续传播。
  for (const [key, value] of [
    ['tab', 'bindings'],
    ['localTab', 'storage'],
    ['helpTab', 'channels'],
    ['reviewMode', 'store'],
    ['releaseView', 'single'],
    ['accountChannel', 'all'],
  ])
    if (key && params.get(key) === value) params.delete(key)
  const result = new URLSearchParams({ view })
  for (const key of pageKeys(params, view)) {
    const value = params.get(key)
    if (value && !(key.endsWith('Page') && value === '1')) result.set(key, value)
  }
  return result
}

/** 返回列表只携带列表自己的筛选；用于历史记录和可在新标签页打开的面包屑。 */
export function releaseListSearch(params: URLSearchParams): string {
  const list = new URLSearchParams({ view: 'releases' })
  for (const key of releaseFilters) {
    const value = params.get(key)
    if (value) list.set(key, value)
  }
  return normalizeWorkbenchSearch(list).toString()
}
