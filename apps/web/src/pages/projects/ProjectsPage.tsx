/** @description 项目导航与应用管理编排，使用 Ant Design 展示服务端事实，URL 仅维护资源定位。 */
import { useRef, useState, type ComponentRef } from 'react'
import { Alert, Avatar, Button, Card, Empty, Spin, Statistic, Tag } from 'antd'
import type { Project } from '@release-harbor/contracts'
import { BrandMark } from '../../components/BrandMark.tsx'
import { ProjectWorkspace } from './ProjectWorkspace.tsx'
import { ProjectForm } from './ProjectForm.tsx'
import { frameworkNames } from './projectConfig.ts'
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
  const [showForm, setShowForm] = useState(false)
  const [notice, setNotice] = useState('')
  const trigger = useRef<ComponentRef<typeof Button>>(null)
  const selected = projects.find((project) => project.id === projectId)
  function close(): void {
    setShowForm(false)
    trigger.current?.focus()
  }
  return (
    <>
      {!projectId && (
        <section className="workspace-metrics" aria-label="工作空间概况">
          <Card>
            <Statistic
              title="已创建项目"
              value={loading ? '—' : String(projects.length).padStart(2, '0')}
            />
            <p className="metric-description">真实保存在本机工作空间</p>
          </Card>
          <Card>
            <Statistic title="已接入工程渠道" value="02" />
            <p className="metric-description">华为草稿 · 小米更新提交</p>
          </Card>
          <Card>
            <p className="metric-description">当前交付</p>
            <h2 className="delivery-title">自动准备与一次确认</h2>
            <Tag color="green">配置管理已开放</Tag>
            <Tag>小米真实验收待完成</Tag>
          </Card>
        </section>
      )}
      {!projectId && (
        <div className="section-title project-title">
          <h2>
            {selected ? '项目工作空间' : '全部项目'} <Tag>{projects.length}</Tag>
          </h2>
          <Button
            ref={trigger}
            type="primary"
            disabled={!connected}
            onClick={() => {
              setShowForm(true)
              setNotice('')
            }}
          >
            新建项目
          </Button>
        </div>
      )}
      {notice && (
        <Alert role="status" type="success" showIcon title={notice} className="form-feedback" />
      )}
      {showForm && (
        <ProjectForm
          onCancel={close}
          onSaved={(project) => {
            close()
            onRefresh()
            select(project.id)
            setNotice('项目已保存到本机工作空间')
          }}
        />
      )}
      {loading ? (
        <div className="loading-panel" role="status">
          <Spin />
          <p>正在加载项目…</p>
        </div>
      ) : selected ? (
        <ProjectWorkspace project={selected} navigation={navigation} />
      ) : projectId ? (
        <Alert
          type="error"
          showIcon
          title="当前工作空间找不到该项目。"
          action={<Button onClick={() => select()}>返回项目列表</Button>}
        />
      ) : projects.length === 0 ? (
        <Card>
          <Empty
            image={<BrandMark small />}
            description={
              <div>
                <h2 className="empty-project-title">从第一个项目开始</h2>
                <p>为 React Native、Flutter 或原生应用建立独立项目空间。</p>
              </div>
            }
          >
            <Button disabled={!connected} onClick={() => setShowForm(true)}>
              创建第一个项目 ↗
            </Button>
          </Empty>
        </Card>
      ) : (
        <div className="projects-grid">
          {projects.map((project) => (
            <Card
              key={project.id}
              hoverable
              title={
                <div className="project-card-heading">
                  <Avatar shape="square" style={{ background: '#f1f5f9', color: '#475569' }}>
                    {project.name.slice(0, 1)}
                  </Avatar>
                  <h3>{project.name}</h3>
                </div>
              }
              extra={<Tag>{frameworkNames[project.framework]}</Tag>}
            >
              <code>{project.key}</code>
              <p className="binding-explanation">{project.description || '暂未添加项目说明'}</p>
              <Button
                onClick={() => {
                  select(project.id)
                  setNotice('')
                }}
              >
                管理应用与商店目标 ↗
              </Button>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
