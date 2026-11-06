/** @description 发布中心内的应用发布工作区；应用按完整归属读取，原有摘要及一次确认流程独立保留。 */
import { Alert, Breadcrumb, Button, Card, Flex, Spin, Tag, Typography } from 'antd'
import { updateUrlState, useUrlState } from '../../app/useUrlState.ts'
import { useApplications } from '../applications/useApplicationData.ts'
import { ReleasePlansPanel } from '../releasePlans/ReleasePlansPanel.tsx'
import { AppleReviewPanel } from '../appleReview/AppleReviewPanel.tsx'

/** 通过项目范围恢复应用；父组件以完整项目和应用 key 隔离草稿。 */
interface Props {
  /** 当前 URL 的项目 ID，服务端再次校验。 */
  projectId: string
  /** 当前 URL 的应用 ID，不构成执行许可。 */
  applicationId: string
}

/**
 * 读取失败可恢复；未知定位明确报错，不能把另一应用作为默认目标。
 * 长函数保留原因：集中展示加载、错误与当前应用的互斥布局，发布业务分别由独立面板负责。
 */
export function ReleaseWorkspace({ projectId, applicationId }: Props) {
  const data = useApplications(projectId)
  const params = useUrlState()
  const application = data.items.find((item) => item.id === applicationId)
  // 旧审核链接只恢复发布工作区，不能重新挂载配置页中的审核表单。
  const apple = params.get('releaseApple') === 'review' || params.get('tab') === 'apple-review'
  const listUrl = new URL(window.location.href)
  for (const key of ['releaseTask', 'tab', 'plan', 'batch', 'batchRevision', 'releaseApple'])
    listUrl.searchParams.delete(key)
  listUrl.searchParams.set('view', 'releases')
  function back(): void {
    updateUrlState({
      view: 'releases',
      releaseTask: '',
      tab: '',
      plan: '',
      batch: '',
      batchRevision: '',
      releaseApple: '',
    })
  }
  return (
    <Flex vertical gap={20} className="release-workspace">
      <Breadcrumb
        items={[
          {
            title: (
              <a
                href={listUrl.pathname + listUrl.search}
                onClick={(event) => {
                  if (
                    event.button === 0 &&
                    !event.metaKey &&
                    !event.ctrlKey &&
                    !event.shiftKey &&
                    !event.altKey
                  ) {
                    event.preventDefault()
                    back()
                  }
                }}
              >
                发布中心
              </a>
            ),
          },
          { title: '应用发布' },
        ]}
      />
      {data.loading ? (
        <Spin aria-label="正在读取发布应用" />
      ) : data.error ? (
        <Alert
          role="alert"
          type="error"
          showIcon
          title={data.error}
          action={<Button onClick={data.refresh}>重新读取应用</Button>}
        />
      ) : !application ? (
        <Alert
          role="alert"
          type="error"
          showIcon
          title="当前项目下找不到该发布应用。"
          action={<Button onClick={back}>返回发布中心</Button>}
        />
      ) : (
        <>
          <header className="release-workspace-header">
            <div className="release-workspace-identity">
              <Flex gap={8} align="center" className="release-workspace-title">
                <Typography.Title level={3} style={{ margin: 0 }}>
                  {application.name}
                </Typography.Title>
                <Tag>
                  {application.platform === 'ios'
                    ? 'iOS'
                    : application.platform === 'harmony'
                      ? 'HarmonyOS'
                      : 'Android'}
                </Tag>
              </Flex>
              <Typography.Text type="secondary">{application.identifier}</Typography.Text>
            </div>
            <Flex wrap gap={8} align="center" className="release-workspace-actions">
              <Button onClick={back}>返回发布列表</Button>
              <Button
                onClick={() =>
                  updateUrlState({
                    view: 'projects',
                    tab: 'bindings',
                    releaseTask: '',
                    releaseApple: '',
                  })
                }
              >
                管理应用配置
              </Button>
            </Flex>
          </header>
          {application.platform === 'ios' && (
            <Card size="small">
              <Flex wrap gap={8} align="center">
                <Typography.Text type="secondary">iOS 发布操作</Typography.Text>
                <Button
                  type={apple ? 'default' : 'primary'}
                  onClick={() =>
                    updateUrlState({
                      view: 'releases',
                      releaseTask: 'workspace',
                      tab: '',
                      releaseApple: '',
                      plan: '',
                    })
                  }
                >
                  上传构建
                </Button>
                <Button
                  type={apple ? 'primary' : 'default'}
                  onClick={() =>
                    updateUrlState({
                      view: 'releases',
                      releaseTask: 'workspace',
                      tab: '',
                      releaseApple: 'review',
                      plan: '',
                    })
                  }
                >
                  审核与发布
                </Button>
              </Flex>
            </Card>
          )}
          {apple && application.platform === 'ios' ? (
            <AppleReviewPanel application={application} />
          ) : (
            <ReleasePlansPanel application={application} />
          )}
        </>
      )}
    </Flex>
  )
}
