/** @description 应用管理内上下文导航，列表和应用详情互斥；发布入口保留当前项目与应用筛选。 */
import type { MouseEvent } from 'react'
import { Breadcrumb, Space, Tag, Typography } from 'antd'
import { openReleaseCenter } from '../releaseCenter/releaseCenterPresentation.ts'
import type { Project } from '@release-harbor/contracts'
import { ApplicationManager } from '../applications/ApplicationManager.tsx'
import { frameworkNames } from './projectConfig.ts'
import type { WorkspaceNavigation } from './useSelection.ts'

/** 当前项目和导航由项目页核对，子组件不自行读取其他项目。 */
interface ProjectWorkspaceProps {
  /** 已在当前工作空间找到的项目。 */
  project: Project
  /** URL 定位及明确的导航入口。 */
  navigation: WorkspaceNavigation
}

/** 进入应用后仅保留紧凑面包屑，概览信息留在项目应用列表。 */
export function ProjectWorkspace({ project, navigation }: ProjectWorkspaceProps) {
  const { applicationId, tab, select } = navigation
  function navigate(event: MouseEvent, projectId = ''): void {
    // 保留标准链接的新标签页／组合键行为，普通点击交给现有 URL 导航。
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return
    event.preventDefault()
    select(projectId)
  }
  return (
    <>
      <Breadcrumb
        className="workspace-breadcrumb"
        aria-label="项目导航"
        items={[
          {
            title: '全部项目',
            href: `${window.location.pathname}?view=projects`,
            onClick: (event) => navigate(event),
          },
          applicationId
            ? {
                title: project.name,
                href: `${window.location.pathname}?project=${encodeURIComponent(project.id)}`,
                onClick: (event) => navigate(event, project.id),
              }
            : { title: project.name },
          ...(applicationId ? [{ title: '应用工作台' }] : []),
        ]}
      />
      {!applicationId && (
        <div className="project-workspace-heading">
          <p className="eyebrow">PROJECT / APPLICATIONS</p>
          <h1>{project.name}</h1>
          <Space wrap>
            <Tag>{frameworkNames[project.framework]}</Tag>
            <Typography.Text type="secondary">项目标识：{project.key}</Typography.Text>
          </Space>
          {project.description && <p className="binding-explanation">{project.description}</p>}
        </div>
      )}
      <ApplicationManager
        key={project.id}
        projectId={project.id}
        applicationId={applicationId}
        tab={tab}
        onSelect={(id) => select(project.id, id)}
        onTabChange={(value) => select(project.id, applicationId, value)}
        onOpenReleaseCenter={() => openReleaseCenter(project.id, applicationId)}
      />
    </>
  )
}
