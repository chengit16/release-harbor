/** @description 成员应用目录只读展示获准渠道，配置写入仍由管理员维护。 */
import { Alert, Card, Empty, Flex, Tag, Typography } from 'antd'
import { useEffect, useState } from 'react'
import {
  channelLabels,
  type Project,
  type Application,
  type ChannelBinding,
} from '@release-harbor/contracts'
import { listApplications, listBindings } from '../../api/services/applications.ts'

/** 仅从服务端过滤后的目录加载公开身份和渠道，不挂载账号维护表单。 */
export function MemberApplications({ projects }: { /** 可访问项目。 */ projects: Project[] }) {
  const [items, setItems] = useState<{ app: Application; bindings: ChannelBinding[] }[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    const c = new AbortController()
    void Promise.all(
      projects.map(async (p) => {
        const apps = await listApplications(p.id, c.signal)
        return Promise.all(
          apps.map(async (app) => ({ app, bindings: await listBindings(p.id, app.id, c.signal) })),
        )
      }),
    ).then(
      (v) => {
        if (!c.signal.aborted) setItems(v.flat())
      },
      (e: unknown) => {
        if (!c.signal.aborted) setError(e instanceof Error ? e.message : '应用读取失败')
      },
    )
    return () => c.abort()
  }, [projects])
  return (
    <Flex vertical gap={16}>
      <Alert
        type="info"
        showIcon
        title="应用配置由管理员维护"
        description="这里仅显示分配给你的应用和渠道；发布和审核分别从对应菜单操作。"
      />
      {error && <Alert type="error" title={error} />}
      {!items.length && !error && <Empty description="暂无已授权应用" />}
      {items.map(({ app, bindings }) => (
        <Card key={app.id} title={app.name} extra={<Tag>{app.platform}</Tag>}>
          <Typography.Paragraph>{app.identifier}</Typography.Paragraph>
          <Flex gap={8} wrap>
            {bindings.map((b) => (
              <Tag key={b.id}>
                {channelLabels[b.channel]} · {b.appId}
              </Tag>
            ))}
          </Flex>
        </Card>
      ))}
    </Flex>
  )
}
