/** @description 独立审核状态详情，荣耀沿用原显式查询；其他渠道只展示既有事实并跳转原发布记录。 */
import { Alert, Button, Descriptions, Drawer, Flex, Spin, Tag, Typography } from 'antd'
import {
  channelLabels,
  reviewTrackingStates,
  reviewTrackingTodos,
  attemptMessages,
  appleReviewMessages,
  appleVersionStates,
  type ReviewTrackingItem,
} from '@release-harbor/contracts'
import { openReleaseWorkspace } from '../releaseCenter/releaseCenterPresentation.ts'
import { ReleaseObservationPanel } from './ReleaseObservationPanel.tsx'
/** 已选记录来自安全汇总，读取失败与记录缺失分别显示。 */
interface Props {
  open: boolean
  item: ReviewTrackingItem | undefined
  loading: boolean
  error: string
  onClose: () => void
  onRetry: () => void
}
/** 查询只在此独立菜单中出现，不复制执行确认或人工核对表单。 */
export function ReviewTrackingDetail({ open, item, loading, error, onClose, onRetry }: Props) {
  return (
    <Drawer
      title="审核状态详情"
      open={open}
      onClose={onClose}
      size="large"
      styles={{ wrapper: { maxWidth: '100vw' } }}
      extra={<Button onClick={onClose}>关闭审核详情</Button>}
    >
      {loading ? (
        <Spin aria-label="正在读取审核详情" />
      ) : error ? (
        <Alert
          role="alert"
          type="error"
          showIcon
          title={error}
          action={<Button onClick={onRetry}>重新读取审核详情</Button>}
        />
      ) : !item ? (
        <Alert role="alert" type="warning" showIcon title="当前本机记录中找不到该审核目标。" />
      ) : (
        <>
          <Flex wrap align="center" gap={8} className="review-tracking-detail-identity">
            <Typography.Title level={4} style={{ margin: 0, minWidth: 0 }}>
              {item.applicationName}
            </Typography.Title>
            <Tag>{channelLabels[item.channel]}</Tag>
          </Flex>
          <Descriptions
            column={1}
            className="form-feedback"
            items={[
              { key: 'project', label: '项目', children: item.projectName },
              {
                key: 'time',
                label: '原操作时间',
                children: new Date(item.createdAt).toLocaleString(),
              },
              {
                key: 'version',
                label: '本次版本',
                children: `${item.versionName} (${item.buildNumber})`,
              },
              {
                key: 'receipt',
                label: '原执行回执',
                children:
                  item.kind === 'plan'
                    ? attemptMessages[item.receiptCode]
                    : appleReviewMessages[item.receiptCode],
              },
              ...(item.kind === 'plan' && item.channel === 'honor'
                ? []
                : [
                    {
                      key: 'state',
                      label: '已知审核状态',
                      children: reviewTrackingStates[item.state],
                    },
                  ]),
              ...(item.kind === 'plan' && item.channel === 'honor'
                ? []
                : [{ key: 'todo', label: '待处理事项', children: reviewTrackingTodos[item.todo] }]),
            ]}
          />
          {item.kind === 'plan' && item.channel === 'honor' ? (
            <ReleaseObservationPanel
              key={item.id}
              projectId={item.projectId}
              applicationId={item.applicationId}
              planId={item.id}
            />
          ) : (
            <Alert
              className="form-feedback"
              type="info"
              showIcon
              title={
                item.channel === 'xiaomi'
                  ? '小米官方暂未开放审核状态查询'
                  : '当前渠道尚未接入此处的状态查询'
              }
              description={
                item.appleObservation
                  ? `Apple 已有观察：${appleVersionStates[item.appleObservation.state] ?? item.appleObservation.state} · ${new Date(item.appleObservation.checkedAt).toLocaleString()}（非实时）。可到原发布工作区明确刷新。`
                  : item.channel === 'app_store'
                    ? '可点击“查看发布记录”，回到已有 Apple 工作区明确刷新。进入本菜单不自动查询 Apple。'
                    : '本页保留原提交事实，请到对应商店后台核对当前版本；没有观察不等于审核中。'
              }
            />
          )}
          <Button
            onClick={() =>
              openReleaseWorkspace(
                item.projectId,
                item.applicationId,
                item.kind === 'apple' ? 'apple' : 'plan',
                item.id,
              )
            }
          >
            查看发布记录
          </Button>
        </>
      )}
    </Drawer>
  )
}
