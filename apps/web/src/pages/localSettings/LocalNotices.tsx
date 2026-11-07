/** @description 通知历史与定位；只读跳转不能代替发布确认，标记已读不完成待办。 */
import { Button, Empty, Flex, List, Tag, Typography } from 'antd'
import type { LocalNotice } from '@release-harbor/contracts'
import { updateUrlState } from '../../app/useUrlState.ts'
import { readLocalNotice } from '../../api/services/localEfficiency.ts'
/** 通知安全定位到已有审核详情，不传入任何授权字段。 */
export function openLocalNotice(notice: LocalNotice): void {
  updateUrlState(
    notice.bindingId
      ? {
          view: 'reviews',
          reviewMode: '',
          reviewRecord: '',
          reviewChannel: '',
          reviewState: '',
          reviewTodo: '',
          reviewPage: '',
          reviewProject: notice.projectId ?? '',
          reviewApplication: notice.applicationId ?? '',
          reviewTarget: notice.bindingId,
        }
      : { view: 'settings', localTab: 'backups' },
  )
}
/** 有界历史保留来源时间，已读和业务处理分别表达。 */
export function LocalNotices({
  notices,
  onRefresh,
  onError,
}: {
  /** 安全通知记录。 */ notices: LocalNotice[]
  /** 已读后重读。 */ onRefresh: () => void
  /** 错误由最近页面展示。 */ onError: (message: string) => void
}) {
  if (!notices.length)
    return <Empty description="暂无通知，开启审核跟踪后可在此查看变化和待处理事项。" />
  return (
    <List
      pagination={{ pageSize: 10 }}
      dataSource={notices}
      renderItem={(n) => (
        <List.Item>
          <Flex vertical gap={8} style={{ width: '100%', minWidth: 0 }}>
            <Flex wrap gap={8} align="center">
              <Tag color={n.read ? 'default' : 'blue'}>{n.read ? '已读' : '未读'}</Tag>
              <Typography.Text strong>{n.title}</Typography.Text>
            </Flex>
            <Typography.Text style={{ overflowWrap: 'anywhere' }}>{n.detail}</Typography.Text>
            <Typography.Text type="secondary">
              {new Date(n.createdAt).toLocaleString()}（观察时间，非实时）
            </Typography.Text>
            <Flex wrap gap={8}>
              <Button onClick={() => openLocalNotice(n)}>查看事项</Button>
              {!n.read && (
                <Button
                  onClick={() => {
                    void readLocalNotice(n.id)
                      .then(onRefresh)
                      .catch((e) => onError(e instanceof Error ? e.message : '标记未完成'))
                  }}
                >
                  标为已读
                </Button>
              )}
            </Flex>
          </Flex>
        </List.Item>
      )}
    />
  )
}
