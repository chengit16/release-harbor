/** @description 跨项目发布中心，组合只读列表、URL 筛选和独立发布工作区；原发布授权边界保持不变。 */
import { useState } from 'react'
import { Alert, Button, Card, Empty, Flex, Typography } from 'antd'
import { updateUrlState, useUrlState } from '../../app/useUrlState.ts'
import { ReleaseCenterFilters } from './ReleaseCenterFilters.tsx'
import { ReleaseCenterTable } from './ReleaseCenterTable.tsx'
import { StartReleaseModal } from './StartReleaseModal.tsx'
import { ReleaseWorkspace } from './ReleaseWorkspace.tsx'
import { useReleaseCenter } from './useReleaseCenter.ts'
import '../../styles/release-center.css'

/** 顶层只决定列表与工作区互斥，避免进入详情时额外扫描全部应用产物。 */
export function ReleaseCenterPage() {
  const params = useUrlState()
  const projectId = params.get('project') ?? '',
    applicationId = params.get('application') ?? ''
  const workspace =
    params.get('releaseTask') === 'workspace' ||
    params.get('tab') === 'plans' ||
    params.get('tab') === 'apple-review'
  return workspace && projectId && applicationId ? (
    <ReleaseWorkspace
      key={`${projectId}:${applicationId}`}
      projectId={projectId}
      applicationId={applicationId}
    />
  ) : (
    <ReleaseCenterList />
  )
}

function ReleaseCenterList() {
  const data = useReleaseCenter()
  const [starting, setStarting] = useState(false)
  const projects = data.response?.projects ?? []
  const hasApplications = projects.some((project) => project.applications.length > 0)
  const hasFilters = Object.values(data.filters).some(Boolean)
  return (
    <section aria-label="发布中心" className="release-center">
      <Flex wrap gap={12} justify="space-between" align="center">
        <Typography.Text type="secondary">
          统一查看发布计划与批次，执行回执、审核和上架事实分别核对。
        </Typography.Text>
        <Flex wrap gap={8}>
          <Button onClick={data.refresh} loading={data.loading}>
            刷新发布记录
          </Button>
          <Button
            type="primary"
            disabled={data.loading || !!data.error || !hasApplications}
            onClick={() => setStarting(true)}
          >
            发起发布
          </Button>
        </Flex>
      </Flex>
      {data.error && (
        <Alert
          role="alert"
          type="error"
          showIcon
          title={data.error}
          description="发布记录读取失败，请重新读取后再操作；失败不会显示为暂无历史。"
          action={<Button onClick={data.refresh}>重新读取</Button>}
        />
      )}
      <Card className="release-center-card">
        <ReleaseCenterFilters projects={projects} filters={data.filters} onChange={data.filter} />
        <Typography.Paragraph type="secondary">
          {data.loading
            ? '正在读取发布记录…'
            : data.error
              ? '记录读取失败'
              : `找到 ${data.visible.length} 条发布记录`}
        </Typography.Paragraph>
        {!data.error && !data.loading && data.visible.length === 0 ? (
          <Empty
            description={
              hasFilters
                ? '没有符合当前筛选条件的发布记录。'
                : hasApplications
                  ? '尚无发布记录，从一次发布开始。'
                  : '先创建项目和应用，再发起发布。'
            }
          >
            {!hasApplications && (
              <Button
                onClick={() =>
                  updateUrlState({ view: 'projects', project: '', application: '', tab: '' })
                }
              >
                前往应用管理
              </Button>
            )}
          </Empty>
        ) : (
          !data.error && <ReleaseCenterTable items={data.visible} loading={data.loading} />
        )}
      </Card>
      {starting && (
        <StartReleaseModal
          projects={projects.filter(
            (project) => !data.filters.project || project.id === data.filters.project,
          )}
          applicationId={data.filters.application}
          onClose={() => setStarting(false)}
        />
      )}
    </section>
  )
}
