/** @description 安全操作日志列表；授权范围与发布回执分开呈现，不把许可或匹配状态视作商店成功。 */
import { Collapse, Descriptions, Empty, Flex, List, Tag, Typography } from 'antd'
import {
  teamAuditActions,
  attemptMessages,
  appleReviewMessages,
  teamMenus,
  teamOperations,
  teamReleaseActions,
  type LocalTeamMember,
  type TeamAuditEvent,
  type TeamGrantOption,
} from '@release-harbor/contracts'

/** 日志显示所需的最小数据；候选名称仅辅助当前目录识别，历史 ID 始终保留。 */
interface Props {
  /** 已经服务端过滤并分页的事件。 */ items: TeamAuditEvent[]
  /** 请求加载状态。 */ loading?: boolean
  /** 当前应用目录，仅管理员传入以显示友好名称。 */ options?: TeamGrantOption[]
}
/** 桌面及手机共用可换行记录，变更前后范围按需展开。 */
export function TeamAuditList({ items, loading, options = [] }: Props) {
  return (
    <List
      loading={loading}
      dataSource={items}
      rowKey="id"
      locale={{
        emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无符合条件的日志" />,
      }}
      renderItem={(event) => (
        <List.Item>
          <Flex vertical gap={8} style={{ width: '100%', minWidth: 0, overflowWrap: 'anywhere' }}>
            <Flex gap={8} wrap align="center">
              <Typography.Text strong>{teamAuditActions[event.action]}</Typography.Text>
              <Typography.Text>{event.actor.username}</Typography.Text>
              <Tag color={event.state === 'unmatched' ? 'warning' : undefined}>
                {event.state === 'atomic'
                  ? '变更已保存'
                  : event.state === 'matched'
                    ? '已匹配本机记录'
                    : '未匹配业务记录'}
              </Tag>
            </Flex>
            <Typography.Text type="secondary">
              {new Date(event.at).toLocaleString()}
              {event.member && ` · 目标成员：${event.member.after.username}`}
              {event.target &&
                ` · ${options.find((o) => o.applicationId === event.target?.applicationId)?.label ?? '应用 ' + event.target.applicationId}`}
            </Typography.Text>
            <Collapse
              size="small"
              items={[
                {
                  key: 'details',
                  label: event.member ? '查看变更前后范围' : '查看记录关联',
                  children: event.member ? (
                    <Flex vertical gap={16}>
                      <MemberScope label="变更前" member={event.member.before} options={options} />
                      <MemberScope label="变更后" member={event.member.after} options={options} />
                      {event.action === 'member_reset' && (
                        <Typography.Text type="secondary">
                          仅记录密码已重置，不保存密码或派生材料。
                        </Typography.Text>
                      )}
                    </Flex>
                  ) : (
                    <Descriptions
                      column={1}
                      size="small"
                      items={[
                        { key: 'record', label: '发布记录', children: event.target?.recordId },
                        {
                          key: 'ref',
                          label: '授权／尝试／版本',
                          children: event.target?.referenceId,
                        },
                        ...(event.outcome
                          ? [
                              {
                                key: 'receipt',
                                label: '关联执行回执',
                                children: `${event.outcome.id} · ${outcomeMessage(event)}${event.outcome.finishedAt ? ' · ' + new Date(event.outcome.finishedAt).toLocaleString() : ''}`,
                              },
                            ]
                          : []),
                      ]}
                    />
                  ),
                },
              ]}
            />
          </Flex>
        </List.Item>
      )}
    />
  )
}
function MemberScope({
  label,
  member,
  options,
}: {
  label: string
  member: LocalTeamMember | null
  options: TeamGrantOption[]
}) {
  const p = member?.permissions
  return (
    <Flex vertical gap={8}>
      <Typography.Text strong>{label}</Typography.Text>
      {!member ? (
        <Typography.Text type="secondary">成员尚未创建</Typography.Text>
      ) : (
        <>
          <Typography.Text>
            {member.username} · {member.enabled ? '已启用' : '已停用'} · 权限版本 {p?.revision ?? 0}
          </Typography.Text>
          <Typography.Text>
            菜单：{p?.menus.map((m) => teamMenus[m]).join('、') || '无'}
          </Typography.Text>
          {!p?.applications?.length && !p?.grants.length && (
            <Typography.Text type="secondary">无应用操作权限</Typography.Text>
          )}
          {p?.applications?.map((g) => (
            <Typography.Text key={g.applicationId}>
              {options.find(
                (o) => o.projectId === g.projectId && o.applicationId === g.applicationId,
              )?.label ?? g.applicationId}
              {`（${g.projectId} / ${g.applicationId}）：${g.operations.map((o) => teamOperations[o]).join('、') || '无'}；覆盖当前及后续渠道`}
            </Typography.Text>
          ))}
          {p?.grants.map((g) => (
            <Typography.Text key={g.bindingId}>
              旧渠道 {g.projectId} / {g.applicationId} / {g.bindingId}：
              {g.operations.map((o) => teamOperations[o]).join('、') || '无'}
              ；动作 {g.releaseActions.map((a) => teamReleaseActions[a]).join('、') || '无'}
              ；配置指纹 {g.fingerprint}
            </Typography.Text>
          ))}
        </>
      )}
    </Flex>
  )
}

function outcomeMessage(event: TeamAuditEvent): string {
  const messages = event.target?.kind === 'apple' ? appleReviewMessages : attemptMessages
  return (
    Object.entries(messages).find(([code]) => code === event.outcome?.code)?.[1] ??
    '请查看原执行回执'
  )
}
