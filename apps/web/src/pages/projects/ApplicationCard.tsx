/** @description 应用目录卡片，配置摘要只读取本机绑定，不执行鉴权、预检或商店查询。 */
import { Button, Card, Flex, Tag, Typography } from 'antd'
import { channelLabels, type Application } from '@release-harbor/contracts'
import { useBindings } from '../applications/useApplicationData.ts'
import { openReleaseCenter } from '../releaseCenter/releaseCenterPresentation.ts'

/** 统一应用身份与渠道摘要；维护和发布入口按调用方资格显示，保存状态不代表商店权限通过。 */
export function ApplicationCard({
  application,
  projectName,
  onSelect,
  canOpenReleaseCenter = true,
}: {
  /** 当前可信应用。 */ application: Application
  /** 已读取的公开项目名。 */ projectName: string | undefined
  /** 进入应用配置，携带完整归属；成员只读目录省略。 */ onSelect?: (
    projectId: string,
    applicationId: string,
  ) => void
  /** 仅控制导航按钮，省略保留原入口；真正操作仍由服务端鉴权。 */ canOpenReleaseCenter?: boolean
}) {
  const bindings = useBindings(application.projectId, application.id)
  return (
    <Card
      className="application-directory-card"
      title={
        <Flex wrap gap={8} align="center">
          <h3 style={{ margin: 0 }}>{application.name}</h3>
          <Tag>
            {application.platform === 'ios'
              ? 'iOS'
              : application.platform === 'harmony'
                ? 'HarmonyOS'
                : 'Android'}
          </Tag>
        </Flex>
      }
    >
      <Typography.Paragraph type="secondary">{projectName}</Typography.Paragraph>
      <Typography.Paragraph className="application-identifier">
        {application.identifier}
      </Typography.Paragraph>
      <Flex wrap gap={4} className="application-directory-channels">
        {bindings.loading ? (
          <Typography.Text type="secondary">正在读取渠道配置…</Typography.Text>
        ) : bindings.error ? (
          <Button type="link" onClick={bindings.refresh}>
            配置摘要读取失败，重试
          </Button>
        ) : bindings.items.length ? (
          bindings.items.map((item) => <Tag key={item.id}>{channelLabels[item.channel]}</Tag>)
        ) : (
          <Tag color="warning">待配置渠道</Tag>
        )}
      </Flex>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        本机配置摘要，发布权限在准备时核对。
      </Typography.Paragraph>
      {(onSelect || canOpenReleaseCenter) && (
        <Flex wrap gap={8}>
          {onSelect && (
            <Button onClick={() => onSelect(application.projectId, application.id)}>
              管理应用配置
            </Button>
          )}
          {canOpenReleaseCenter && (
            <Button onClick={() => openReleaseCenter(application.projectId, application.id)}>
              前往发布中心
            </Button>
          )}
        </Flex>
      )}
    </Card>
  )
}
