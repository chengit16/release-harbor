/** @description 项目导航与应用管理编排，使用 Ant Design 展示服务端事实，URL 仅维护资源定位。 */
import { useState } from 'react'
import { Alert, Button, Flex, Spin } from 'antd'
import type { Project } from '@release-harbor/contracts'
import { ProjectWorkspace } from './ProjectWorkspace.tsx'
import { ProjectForm } from './ProjectForm.tsx'
import { updateUrlState, useUrlState } from '../../app/useUrlState.ts'
import { ApplicationDirectory } from './ApplicationDirectory.tsx'
import { ApplicationSetup } from './ApplicationSetup.tsx'
import type { WorkspaceNavigation } from './useSelection.ts'

/** 项目页的服务端事实与刷新入口。 */
export interface ProjectsPageProps {
  /** 当前工作空间的公开项目列表。 */
  projects: Project[]
  /** 壳层共享 URL 定位，以隐藏详情中重复的项目概览。 */
  navigation: WorkspaceNavigation
  /** 重新获取列表时避免把缺失项误判为不存在。 */
  loading: boolean
  /** 只控制 UI，不替代服务端校验。 */
  connected: boolean
  /** 创建成功后重新读取事实。 */
  onRefresh: () => void
}

/**
 * 项目列表、创建与项目内应用入口。
 * 长函数保留原因：保留互斥视图及导航反馈的声明式关系，创建和应用业务已分为独立组件。
 */
export function ProjectsPage({
  projects,
  loading,
  connected,
  onRefresh,
  navigation,
}: ProjectsPageProps) {
  const { projectId, select } = navigation
  const [form, setForm] = useState<'project' | 'application' | ''>(
    useUrlState().get('applicationSetup') === '1' ? 'application' : '',
  )
  const [notice, setNotice] = useState('')
  const selected = projects.find((project) => project.id === projectId)
  // 创建后刷新项目目录不能卸载正在配置渠道的向导。
  if (loading && form !== 'application') return <Spin aria-label="正在加载项目" />
  if (selected)
    return (
      <>
        {notice && <Alert role="status" type="success" title={notice} />}
        <ProjectWorkspace project={selected} navigation={navigation} />
      </>
    )
  if (projectId)
    return (
      <Alert
        type="error"
        title="当前工作空间找不到该项目。"
        action={<Button onClick={() => select()}>返回应用列表</Button>}
      />
    )
  return (
    <>
      <Flex wrap gap={8} justify="end" style={{ marginBottom: 20 }}>
        <Button disabled={!connected} onClick={() => setForm('project')}>
          新建项目
        </Button>
        <Button type="primary" disabled={!connected} onClick={() => setForm('application')}>
          新建应用
        </Button>
      </Flex>
      {form === 'project' ? (
        <ProjectForm
          onCancel={() => setForm('')}
          onSaved={(project) => {
            setForm('')
            setNotice('项目已保存到本机工作空间')
            onRefresh()
            select(project.id)
          }}
        />
      ) : form === 'application' ? (
        <ApplicationSetup
          projects={projects}
          onCreated={onRefresh}
          onClose={() => {
            setForm('')
            updateUrlState({ applicationSetup: '' })
          }}
          onOpen={(project, application) => {
            setForm('')
            select(project, application)
          }}
        />
      ) : (
        <ApplicationDirectory
          projects={projects}
          onSelect={(project, application) => select(project, application)}
        />
      )}
    </>
  )
}
