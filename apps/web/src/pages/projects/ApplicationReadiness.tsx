/** @description 首次配置的本机就绪摘要，仅 GET 读取渠道与安装包，不运行官方鉴权或预检。 */
import { Alert, Button, Flex, Spin, Tag, Typography } from 'antd'
import type { Application } from '@release-harbor/contracts'
import { useBindings } from '../applications/useApplicationData.ts'
import { useArtifacts } from '../artifacts/useArtifacts.ts'
import { updateUrlState } from '../../app/useUrlState.ts'
import { openReleaseWorkspace } from '../releaseCenter/releaseCenterPresentation.ts'

/** 配置存在不等于发布权限有效，真正准备时仍重新核对。 */
export function ApplicationReadiness({
  application,
  onBack,
  onOpen,
}: {
  /** 已保存的应用身份。 */ application: Application
  /** 回到渠道配置继续修正。 */ onBack: () => void
  /** 完成后进入已保存应用。 */ onOpen: () => void
}) {
  const bindings = useBindings(application.projectId, application.id)
  const artifacts = useArtifacts(application.projectId, application.id)
  const loading = bindings.loading || artifacts.loading,
    error = bindings.error || artifacts.error
  const ready = artifacts.records.some((item) => item.status === 'ready')
  return (
    <Flex vertical gap={16}>
      <Typography.Title level={5}>{application.name} · 就绪检查</Typography.Title>
      {loading ? (
        <Spin />
      ) : error ? (
        <Alert type="error" role="alert" title={error} />
      ) : (
        <>
          <Typography.Text>
            <Tag color="success">已登记</Tag>应用身份：{application.identifier}
          </Typography.Text>
          <Typography.Text>
            <Tag color={bindings.items.length ? 'success' : 'warning'}>
              {bindings.items.length ? `已配置 ${bindings.items.length} 个渠道` : '待配置渠道'}
            </Tag>
            账号可在渠道内新增或复用。
          </Typography.Text>
          <Typography.Text>
            <Tag color={ready ? 'success' : 'default'}>{ready ? '已有安装包' : '待上传安装包'}</Tag>
            可在发布页直接上传并检查。
          </Typography.Text>
          <Alert
            type="info"
            showIcon
            title="这里只检查本机配置是否齐全"
            description="不会连接商店。准备发布时系统会重新检查账号、目标和安装包；最后核对摘要并确认才会上传或送审。"
          />
        </>
      )}
      <Flex wrap gap={8}>
        <Button
          onClick={() => {
            bindings.refresh()
            artifacts.refresh()
          }}
        >
          重新检查配置
        </Button>
        <Button onClick={onBack}>返回渠道配置</Button>
        <Button onClick={onOpen}>完成配置</Button>
        <Button
          type="primary"
          disabled={loading || !!error || !bindings.items.length}
          onClick={() => {
            openReleaseWorkspace(application.projectId, application.id)
            updateUrlState({ releaseCompose: '1', releaseSelected: '' })
          }}
        >
          开始发布
        </Button>
      </Flex>
    </Flex>
  )
}
