/** @description 工作台壳层，Ant Design 统一导航与状态反馈，页面通过公开 API 管理业务。 */
import { LocalNoticeBell } from './pages/localSettings/LocalNoticeBell.tsx'
import { lazy, Suspense } from 'react'
import { Alert, Badge, Breadcrumb, Button, Spin, Tag } from 'antd'
import { useWorkbenchView } from './app/useUrlState.ts'
import { BrandMark } from './components/BrandMark.tsx'
import { useCompactLayout } from './app/useCompactLayout.ts'
import { useSelection } from './pages/projects/useSelection.ts'
import { useWorkspace } from './pages/projects/useWorkspace.ts'
import { WorkbenchNavigation, workbenchPages } from './app/workbenchNavigation.tsx'
import { useUrlState } from './app/useUrlState.ts'
import './styles/applications.css'
import './styles/credential-accounts.css'
import './styles/workbench.css'
import './styles/usability.css'
import './styles/workbench-design.css'
import { HelpPage } from './pages/help/HelpPage.tsx'
import type { LocalTeamMember } from '@release-harbor/contracts'
import { TeamAccessProvider, useTeamAccess } from './pages/team/teamAccess.tsx'
import { MemberApplications } from './pages/team/MemberApplications.tsx'
import { TeamGate } from './pages/team/TeamGate.tsx'

// 表格、表单与步骤条按页面载入，避免组件库所有页面进入同一个首屏包。
const LocalSettingsPage = lazy(() =>
  import('./pages/localSettings/LocalSettingsPage.tsx').then((module) => ({
    default: module.LocalSettingsPage,
  })),
)
const ReviewTrackingPage = lazy(() =>
  import('./pages/reviewTracking/ReviewTrackingPage.tsx').then((module) => ({
    default: module.ReviewTrackingPage,
  })),
)
const ReleaseCenterPage = lazy(() =>
  import('./pages/releaseCenter/ReleaseCenterPage.tsx').then((module) => ({
    default: module.ReleaseCenterPage,
  })),
)
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
const TeamControls = lazy(() =>
  import('./pages/team/TeamControls.tsx').then((module) => ({ default: module.TeamControls })),
)

/** 先确认本机会话，再挂载原工作台，避免登录页加载业务数据。 */
export function App() {
  return (
    <TeamGate
      render={(member, onLogout) => (
        <TeamAccessProvider member={member}>
          <Workbench
            key={member ? `${member.id}:${member.permissions?.revision ?? 0}` : 'personal'}
            member={member}
            onLogout={onLogout}
          />
        </TeamAccessProvider>
      )}
    />
  )
}

/**
 * 本地服务状态与功能导航；规划页面不开放真实商店写入口。
 * 长函数保留原因：集中保留壳层的声明式布局，业务状态和各功能页已独立维护。
 */
function Workbench({
  member,
  onLogout,
}: {
  member?: LocalTeamMember
  onLogout?: () => Promise<void>
}) {
  const { view: requestedView, setView } = useWorkbenchView()
  const access = useTeamAccess()
  const allowed = access.restricted
    ? (['releases', 'reviews', 'projects', 'help'] as const).filter((v) => access.menu(v))
    : undefined
  const view =
    !allowed ||
    allowed.some(
      (v) =>
        v === requestedView ||
        (v === 'help' && ['issues', 'channels', 'roadmap'].includes(requestedView)),
    )
      ? requestedView
      : (allowed[0] ?? 'help')
  const noMenus = allowed?.length === 0
  const navigation = useSelection()
  const { projects, status, loading, error, refresh } = useWorkspace(
    !access.restricted || !!allowed?.some((v) => v !== 'help'),
  )
  const compact = useCompactLayout()
  const page = workbenchPages[view]
  const params = useUrlState()
  return (
    <div className="shell">
      <a className="skip-content" href="#workbench-content">
        跳至页面内容
      </a>
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault()
            setView('releases')
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
          <div>{member ? '本机团队空间' : '本地工作空间'}</div>
          <span className="workspace-dot" />
        </div>
        <WorkbenchNavigation
          allowed={allowed}
          view={view}
          compact={compact}
          onSelect={(value) => setView(value)}
        />
        <div className="sidebar-footer">
          <Badge status="success" />
          {member ? '本机团队' : '本地基础版'}
          <span>v0.1</span>
        </div>
      </aside>
      <main>
        <header className={member ? 'topbar local-team-topbar' : 'topbar'}>
          <Breadcrumb items={[{ title: '工作台' }, { title: page.title }]} />
          <div className="topbar-right">
            {!access.restricted && <LocalNoticeBell />}
            {member && onLogout ? (
              <Suspense fallback={null}>
                <TeamControls
                  administrator={!access.restricted}
                  username={member.username}
                  onLogout={onLogout}
                />
              </Suspense>
            ) : (
              <Tag>LOCAL</Tag>
            )}
            <span>{status ? '本机服务已连接' : loading ? '正在连接服务' : '服务连接待检查'}</span>
          </div>
        </header>
        <div
          id="workbench-content"
          tabIndex={-1}
          className={
            view === 'projects' && navigation.projectId ? 'content workbench-content' : 'content'
          }
        >
          {view !== 'accounts' &&
            !(view === 'projects' && navigation.projectId) &&
            !(
              view === 'releases' &&
              (params.get('releaseTask') === 'workspace' ||
                params.get('tab') === 'plans' ||
                params.get('tab') === 'apple-review')
            ) && (
              <div className="page-heading">
                <div>
                  <h1>{page.title}</h1>
                  <p className="subtitle">{page.description}</p>
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
            {noMenus && (
              <Alert
                type="info"
                showIcon
                title="暂无可用菜单"
                description="请联系管理员分配菜单、应用渠道和操作权限，然后刷新页面。"
              />
            )}
            {!noMenus &&
              view === 'projects' &&
              (access.restricted ? (
                <MemberApplications projects={projects} />
              ) : (
                <ProjectsPage
                  projects={projects}
                  navigation={navigation}
                  loading={loading}
                  connected={Boolean(status)}
                  onRefresh={refresh}
                />
              ))}
            {view === 'releases' && <ReleaseCenterPage />}
            {view === 'reviews' && <ReviewTrackingPage />}
            {!noMenus && ['help', 'issues', 'channels', 'roadmap'].includes(view) && (
              <HelpPage
                view={view}
                render={(key) =>
                  key === 'issues' ? (
                    <IssuesPage />
                  ) : key === 'roadmap' ? (
                    <RoadmapPage />
                  ) : (
                    <ChannelsPage />
                  )
                }
              />
            )}
            {view === 'accounts' && <AccountsPage />}
            {view === 'settings' && <LocalSettingsPage />}
          </Suspense>
        </div>
      </main>
    </div>
  )
}
