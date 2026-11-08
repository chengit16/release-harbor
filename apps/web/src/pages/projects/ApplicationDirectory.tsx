/** @description 应用管理默认平铺所有项目的平台应用；仅读公开目录，项目作为筛选和归属。 */
import { useEffect, useState } from 'react'
import { Alert, Button, Card, Empty, Flex, Select, Spin, Tag, Typography } from 'antd'
import type { Application, Project } from '@release-harbor/contracts'
import { listApplications } from '../../api/services/applications.ts'
import { openReleaseCenter } from '../releaseCenter/releaseCenterPresentation.ts'
import { updateUrlState, useUrlState } from '../../app/useUrlState.ts'

/** 平铺目录不获取安装包、执行授权或商店结果。 */
export function ApplicationDirectory({
  projects,
  onSelect,
}: {
  /** 当前可信工作空间的项目。 */ projects: Project[]
  /** 明确选择后进入配置工作台。 */ onSelect: (projectId: string, applicationId: string) => void
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
    Promise.all(projects.map((project) => listApplications(project.id, controller.signal)))
      .then((groups) => {
        if (!controller.signal.aborted) setItems(groups.flat())
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : '应用目录读取失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [projects, revision])
  const visible = items.filter((item) => !group || item.projectId === group)
  return (
    <section aria-label="全部应用">
      <div className="application-directory-toolbar">
        <Typography.Title level={4} style={{ margin: 0 }}>
          全部应用 <Tag>{loading || error ? '—' : visible.length}</Tag>
        </Typography.Title>
        <Select
          aria-label="应用项目分组"
          placeholder="全部项目分组"
          value={group || undefined}
          allowClear
          options={projects.map((project) => ({ value: project.id, label: project.name }))}
          onChange={(value) => updateUrlState({ applicationProject: value ?? '' })}
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
        <Empty description="暂无应用，点击新建应用即可完成应用信息和渠道配置。" />
      ) : (
        <div className="application-list">
          {visible.map((item) => (
            <Card
              key={item.id}
              title={
                <Flex wrap gap={8} align="center">
                  <h3 style={{ margin: 0 }}>{item.name}</h3>
                  <Tag>
                    {item.platform === 'ios'
                      ? 'iOS'
                      : item.platform === 'harmony'
                        ? 'HarmonyOS'
                        : 'Android'}
                  </Tag>
                </Flex>
              }
            >
              <Typography.Paragraph type="secondary">
                {projects.find((project) => project.id === item.projectId)?.name}
              </Typography.Paragraph>
              <Typography.Paragraph className="application-identifier">
                {item.identifier}
              </Typography.Paragraph>
              <Flex wrap gap={8}>
                <Button onClick={() => onSelect(item.projectId, item.id)}>管理应用配置</Button>
                <Button onClick={() => openReleaseCenter(item.projectId, item.id)}>
                  前往发布中心
                </Button>
              </Flex>
            </Card>
          ))}
        </div>
      )}
    </section>
  )
}
