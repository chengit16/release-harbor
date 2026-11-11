/** @description 应用管理默认平铺所有项目的平台应用；仅读公开目录，项目作为筛选和归属。 */
import { useEffect, useState } from 'react'
import { Alert, Button, Empty, Pagination, Select, Spin, Tag, Typography } from 'antd'
import type { Application, Project } from '@release-harbor/contracts'
import { listApplications } from '../../api/services/applications.ts'
import { ApplicationCard } from './ApplicationCard.tsx'
import { useUrlPage } from '../../hooks/useUrlPage.ts'
import { updateUrlState, useUrlState } from '../../app/useUrlState.ts'

/** 分组分批读取本机应用，限制项目目录请求的并发，不请求商店或发布准备。 */
async function loadDirectory(projects: Project[], signal: AbortSignal): Promise<Application[]> {
  const items: Application[] = []
  for (let index = 0; index < projects.length; index += 4) {
    if (signal.aborted) return []
    const groups = await Promise.all(
      projects.slice(index, index + 4).map((project) => listApplications(project.id, signal)),
    )
    items.push(...groups.flat())
  }
  return items
}

/** 平铺目录不获取安装包、执行授权或商店结果。 */
export function ApplicationDirectory({
  projects,
  onSelect,
  canOpenReleaseCenter = true,
}: {
  /** 当前可信工作空间的项目。 */ projects: Project[]
  /** 明确选择后进入配置工作台；成员只读目录省略，不挂载配置入口。 */ onSelect?: (
    projectId: string,
    applicationId: string,
  ) => void
  /** 仅控制发布菜单跳转，省略时保留管理员入口；不产生执行权限。 */ canOpenReleaseCenter?: boolean
}) {
  const [items, setItems] = useState<Application[]>([]),
    [loading, setLoading] = useState(true)
  const [error, setError] = useState(''),
    [revision, setRevision] = useState(0)
  const params = useUrlState(),
    group = params.get('applicationProject') ?? ''
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    loadDirectory(
      projects.filter((project) => !group || project.id === group),
      controller.signal,
    )
      .then((items) => {
        if (!controller.signal.aborted) setItems(items)
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : '应用目录读取失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [projects, revision, group])
  const visible = items.filter((item) => !group || item.projectId === group)
  const pagination = useUrlPage('applicationPage', visible.length, 12)
  const pageItems = visible.slice(
    (pagination.current - 1) * pagination.pageSize,
    pagination.current * pagination.pageSize,
  )
  return (
    <section aria-label="全部应用">
      <div className="application-directory-toolbar">
        <Typography.Title level={2} style={{ margin: 0, fontSize: 20 }}>
          全部应用 <Tag>{loading || error ? '—' : visible.length}</Tag>
        </Typography.Title>
        <Select
          aria-label="应用项目分组"
          placeholder="全部项目分组"
          value={group || undefined}
          allowClear
          options={projects.map((project) => ({ value: project.id, label: project.name }))}
          onChange={(value) =>
            updateUrlState({ applicationProject: value ?? '', applicationPage: '' })
          }
        />
      </div>
      {loading ? (
        <Spin aria-label="正在读取全部应用" />
      ) : error ? (
        <Alert
          type="error"
          role="alert"
          title={error}
          action={<Button onClick={() => setRevision((value) => value + 1)}>重新读取应用</Button>}
        />
      ) : !visible.length ? (
        <Empty
          description={
            onSelect
              ? '暂无应用，点击新建应用即可完成应用信息和渠道配置。'
              : '暂无已授权应用，请联系管理员分配应用权限。'
          }
        />
      ) : (
        <div className="application-list">
          {pageItems.map((item) => (
            <ApplicationCard
              key={item.id}
              application={item}
              projectName={projects.find((project) => project.id === item.projectId)?.name}
              onSelect={onSelect}
              canOpenReleaseCenter={canOpenReleaseCenter}
            />
          ))}
        </div>
      )}
      {!loading && !error && (
        <Pagination
          {...pagination}
          total={visible.length}
          hideOnSinglePage
          style={{ marginTop: 16 }}
        />
      )}
    </section>
  )
}
