/** @description 工作台壳层，Ant Design 统一导航与状态反馈，页面通过公开 API 管理业务。 */
import { lazy, Suspense } from 'react'
import { Alert, Badge, Breadcrumb, Button, Menu, Spin, Tag } from 'antd'
import { useWorkbenchView } from './app/useUrlState.ts'
import { BrandMark } from './components/BrandMark.tsx'
import { useCompactLayout } from './app/useCompactLayout.ts'
import { useSelection } from './pages/projects/useSelection.ts'
import { useWorkspace } from './pages/projects/useWorkspace.ts'
import './styles/applications.css'
import './styles/credential-accounts.css'
import './styles/workbench.css'

const titles = {
  projects: '项目空间',
  accounts: '商店账号',
  issues: '问题与解决',
  channels: '渠道能力',
  roadmap: '演进路线',
}

// 表格、表单与步骤条按页面载入，避免组件库所有页面进入同一个首屏包。
const IssuesPage = lazy(() =>
  import('./pages/issues/IssuesPage.tsx').then((module) => ({ default: module.IssuesPage })),
)
const ProjectsPage = lazy(() =>
  import('./pages/projects/ProjectsPage.tsx').then((module) => ({ default: module.ProjectsPage })),
)
const ChannelsPage = lazy(() =>
  import('./pages/channels/ChannelsPage.tsx').then((module) => ({ default: module.ChannelsPage })),
)
const RoadmapPage = lazy(() =>
  import('./pages/roadmap/RoadmapPage.tsx').then((module) => ({ default: module.RoadmapPage })),
)
const AccountsPage = lazy(() =>
  import('./pages/accounts/AccountsPage.tsx').then((module) => ({ default: module.AccountsPage })),
)

/**
 * 本地服务状态与功能导航；规划页面不开放真实商店写入口。
 * 长函数保留原因：集中保留壳层的声明式布局，业务状态和各功能页已独立维护。
 */
export function App() {
  const { view, setView } = useWorkbenchView()
  const navigation = useSelection()
  const { projects, status, loading, error, refresh } = useWorkspace()
  const compact = useCompactLayout()
  return (
    <div className="shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault()
            setView('projects')
          }}
        >
          <BrandMark />
          <span>
            Release
            <br />
            <strong>Harbor</strong>
          </span>
        </a>
        <div className="workspace">
          <span className="workspace-icon">L</span>
          <div>
            本地工作空间<small>LOCAL WORKSPACE</small>
          </div>
          <span className="workspace-dot" />
        </div>
        <div className="nav-caption">工作台</div>
        <nav aria-label="工作台导航" className="workspace-navigation">
          <Menu
            mode={compact ? 'horizontal' : 'inline'}
            theme="light"
            disabledOverflow
            selectedKeys={[view]}
            style={{ background: 'transparent', border: 0, minWidth: 0, width: '100%' }}
            onClick={({ key }) => {
              if (
                key === 'projects' ||
                key === 'accounts' ||
                key === 'issues' ||
                key === 'channels' ||
                key === 'roadmap'
              )
                setView(key)
            }}
            items={(['projects', 'accounts', 'issues', 'channels', 'roadmap'] as const).map(
              (key, index) => ({
                key,
                icon: compact ? undefined : (
                  <span aria-hidden="true">{['▦', '◇', '▤', '⇄', '↗'][index]}</span>
                ),
                label: (
                  <span className="menu-label">
                    {titles[key]}
                    {key === 'projects' && !compact && (
                      <Badge count={projects.length} showZero color="#64748b" />
                    )}
                  </span>
                ),
              }),
            )}
          />
        </nav>
        <div className="sidebar-note">
          <span className="eyebrow">ONE PLACE. EVERY RELEASE.</span>
          <p>
            让每一次发布，
            <br />
            都有清晰的航线。
          </p>
          <div className="contour" aria-hidden="true">
            ◡<br />◡<br />◡
          </div>
        </div>
        <div className="sidebar-footer">
          <Badge status="success" />
          本地基础版<span>v0.1</span>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <Breadcrumb items={[{ title: '工作台' }, { title: titles[view] }]} />
          <div className="topbar-right">
            <Tag>LOCAL</Tag>
            <span>{status ? '本机服务已连接' : loading ? '正在连接服务' : '服务连接待检查'}</span>
          </div>
        </header>
        <div
          className={
            view === 'projects' && navigation.projectId ? 'content workbench-content' : 'content'
          }
        >
          {!(view === 'projects' && navigation.projectId) && (
            <div className="page-heading">
              <div>
                <p className="eyebrow">
                  RELEASE HARBOR /{' '}
                  {view === 'projects'
                    ? 'PROJECTS'
                    : view === 'issues'
                      ? 'ISSUES'
                      : view === 'accounts'
                        ? 'ACCOUNTS'
                        : view === 'channels'
                          ? 'CHANNELS'
                          : 'ROADMAP'}
                </p>
                <h1>
                  {view === 'projects'
                    ? '每个应用，都有自己的港口。'
                    : view === 'issues'
                      ? '问题与解决'
                      : view === 'accounts'
                        ? '让账号配置，回到页面之内。'
                        : view === 'channels'
                          ? '每个商店，都有清晰的能力边界。'
                          : '从本地工具，走向独立发布产品。'}
                </h1>
                <p className="subtitle">
                  {view === 'projects'
                    ? '集中管理不同项目，逐步建立安装包、渠道与发布记录之间的关联。'
                    : view === 'issues'
                      ? '把遇到的问题、查明的原因和有效的处理方法，留成下一次可查的经验。'
                      : view === 'accounts'
                        ? '配置一次，在应用中选择复用。凭据保存在本机，身份与发布事实分别核对。'
                        : view === 'channels'
                          ? '统一查看适配规划，实际发布能力将在真实渠道验收后开放。'
                          : '以可用的工作台为起点，逐期打通交付、审核与在线协作。'}
                </p>
              </div>
            </div>
          )}
          {error && (
            <Alert
              role="alert"
              type="error"
              showIcon
              title={error}
              className="form-feedback"
              action={<Button onClick={refresh}>重新连接</Button>}
            />
          )}
          <Suspense
            fallback={
              <div className="loading-panel" role="status">
                <Spin />
                <p>正在加载页面…</p>
              </div>
            }
          >
            {view === 'projects' && (
              <ProjectsPage
                projects={projects}
                navigation={navigation}
                loading={loading}
                connected={Boolean(status)}
                onRefresh={refresh}
              />
            )}
            {view === 'issues' && <IssuesPage />}
            {view === 'channels' && <ChannelsPage />}
            {view === 'accounts' && <AccountsPage />}
            {view === 'roadmap' && <RoadmapPage />}
          </Suspense>
          <footer className="content-footer">
            <span>RELEASE HARBOR</span>
            <p>已有安装包接入 · 框架无关 · 项目独立管理</p>
            <span>FOUNDATION / 0.1</span>
          </footer>
        </div>
      </main>
    </div>
  )
}
