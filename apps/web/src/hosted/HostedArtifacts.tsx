/** @description 应用的在线安装包弹窗；显式上传、续传和清理，与应用绑定及发布状态独立。 */
import {
  Alert,
  Button,
  Empty,
  Flex,
  List,
  Modal,
  Popconfirm,
  Progress,
  Tag,
  Typography,
  Upload,
} from 'antd'
import { useEffect, useRef, useState } from 'react'
import {
  hostedArtifactLimits,
  type HostedArtifact,
  type HostedRole,
} from '@release-harbor/contracts'
import {
  decodeArtifactLink,
  decodeHostedArtifact,
  decodeHostedArtifacts,
  hostedArtifactAction,
} from './artifactApi.ts'
import { HostedResource } from './HostedResource.tsx'
import { useHostedData } from './useHostedData.ts'
import { useHostedArtifactUpload } from './useHostedArtifactUpload.ts'

/** 安装包弹窗仅访问当前空间和应用的记录。 */
export interface HostedArtifactsProps {
  /** 当前应用的安装包目录地址。 */
  path: string
  /** 用户界面显示的应用名称。 */
  appName: string
  /** 控制按钮展示；服务端仍重验角色。 */
  role: HostedRole
  /** 关闭后暂停页面传输，服务端保留接收记录。 */
  onClose(): void
}

const statusNames = {
  receiving: '接收中',
  awaiting_check: '待检查',
  cancelled: '已取消',
  removed: '原文件已清理',
}

const stageNames = {
  hashing: '正在核对分片摘要',
  uploading: '正在直传对象存储',
  completing: '正在核对对象版本',
  paused: '上传已暂停',
  failed: '上传未完成',
  done: '已接收 · 待检查',
}

/** 显示空间占用和包记录；查看者没有签发、取消或清理入口。 */
export function HostedArtifacts({ path, appName, role, onClose }: HostedArtifactsProps) {
  const resource = useHostedData(path, decodeHostedArtifacts)
  const [resume, setResume] = useState<HostedArtifact>()
  const upload = useHostedArtifactUpload(path, resource.refresh, () => setResume(undefined))
  const activeAction = useRef<AbortController | undefined>(undefined)
  const [action, setAction] = useState<string>()
  const [error, setError] = useState('')
  const canOperate = role !== 'viewer'

  // 关闭弹窗或切换空间时，迟到的签名响应不能再发起下载。
  useEffect(() => () => activeAction.current?.abort(), [])

  async function act(record: HostedArtifact, verb: 'cancel' | 'download' | 'remove') {
    if (activeAction.current) return
    const controller = new AbortController()
    activeAction.current = controller
    setAction(record.id + verb)
    setError('')
    try {
      const endpoint = path + '/' + record.id + '/' + verb
      if (verb === 'download') {
        const url = await hostedArtifactAction(endpoint, {}, decodeArtifactLink, controller.signal)
        controller.signal.throwIfAborted()
        const link = document.createElement('a')
        link.href = url
        link.rel = 'noreferrer'
        link.referrerPolicy = 'no-referrer'
        link.click()
      } else {
        await hostedArtifactAction(endpoint, {}, decodeHostedArtifact, controller.signal)
        controller.signal.throwIfAborted()
        if (resume?.id === record.id) {
          upload.reset()
          setResume(undefined)
        }
        resource.refresh()
      }
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(reason instanceof Error ? reason.message : '安装包操作未完成')
    } finally {
      activeAction.current = undefined
      if (!controller.signal.aborted) setAction(undefined)
    }
  }

  return (
    <Modal
      open
      title={`${appName} · 安装包`}
      onCancel={onClose}
      footer={<Button onClick={onClose}>关闭</Button>}
      width={690}
    >
      <Typography.Paragraph type="secondary">
        在线只接收 APK。待检查表示对象已保存，尚未核对包名、版本或签名。
      </Typography.Paragraph>
      {error && <Alert type="error" showIcon title={error} />}
      <HostedResource resource={resource}>
        {(result) => (
          <>
            <p className="hosted-artifact-quota">
              <Typography.Text type="secondary">
                空间占用 {sizeLabel(result.reservedBytes)} /{' '}
                {sizeLabel(hostedArtifactLimits.workspaceBytes)}
              </Typography.Text>
            </p>
            {!result.enabled && <Alert type="info" showIcon title="此环境尚未配置在线安装包存储" />}
            {result.enabled && canOperate && (
              <div className="hosted-artifact-upload">
                {resume && (
                  <Typography.Paragraph>
                    继续「{resume.fileName}」，请重新选择原文件。
                  </Typography.Paragraph>
                )}
                <Flex gap={8} wrap="wrap" align="center">
                  <Upload
                    accept=".apk"
                    showUploadList={false}
                    disabled={upload.busy}
                    beforeUpload={(file) => {
                      upload.select(file, resume?.id)
                      return Upload.LIST_IGNORE
                    }}
                  >
                    <Button disabled={upload.busy}>{resume ? '选择原 APK' : '选择 APK'}</Button>
                  </Upload>
                  {upload.fileName && <Typography.Text>{upload.fileName}</Typography.Text>}
                  {upload.fileName && !upload.busy && (
                    <Button type="primary" onClick={upload.start}>
                      {upload.transfer || resume ? '开始续传' : '开始上传'}
                    </Button>
                  )}
                  {upload.busy && upload.transfer?.stage !== 'completing' && (
                    <Button onClick={upload.pause}>暂停</Button>
                  )}
                  {resume && !upload.busy && (
                    <Button
                      type="text"
                      onClick={() => {
                        upload.reset()
                        setResume(undefined)
                      }}
                    >
                      返回新上传
                    </Button>
                  )}
                </Flex>
                {upload.transfer && (
                  <div role="status" className="hosted-artifact-progress">
                    <Typography.Text>{stageNames[upload.transfer.stage]}</Typography.Text>
                    {upload.transfer.stage !== 'hashing' && (
                      <Progress
                        percent={Math.round((upload.transfer.sent * 100) / upload.transfer.total)}
                        status={upload.transfer.stage === 'failed' ? 'exception' : undefined}
                      />
                    )}
                    {upload.transfer.error && (
                      <Alert type="error" showIcon title={upload.transfer.error} />
                    )}
                  </div>
                )}
              </div>
            )}
            {result.items.length ? (
              <List
                dataSource={result.items}
                rowKey="id"
                renderItem={(record) => {
                  const expired =
                    record.status === 'receiving' && Date.parse(record.expiresAt) <= Date.now()
                  return (
                    <List.Item className="hosted-artifact-row">
                      <div>
                        <strong>{record.fileName}</strong>{' '}
                        <Tag color={record.status === 'awaiting_check' ? 'blue' : undefined}>
                          {expired ? '已过期' : statusNames[record.status]}
                        </Tag>
                        <div>
                          <Typography.Text type="secondary">
                            {sizeLabel(record.sizeBytes)}
                          </Typography.Text>
                        </div>
                      </div>
                      {result.enabled && canOperate && !upload.busy && (
                        <Flex gap={4} wrap="wrap">
                          {record.status === 'receiving' && !expired && (
                            <Button
                              type="link"
                              onClick={() => {
                                upload.reset()
                                setResume(record)
                              }}
                            >
                              继续上传
                            </Button>
                          )}
                          {record.status === 'receiving' && (
                            <Popconfirm
                              title="取消本次上传并清理已收分片？"
                              okText="取消上传"
                              onConfirm={() => act(record, 'cancel')}
                            >
                              <Button type="link" danger loading={action === record.id + 'cancel'}>
                                取消上传
                              </Button>
                            </Popconfirm>
                          )}
                          {record.status === 'awaiting_check' && (
                            <Button
                              type="link"
                              loading={action === record.id + 'download'}
                              onClick={() => act(record, 'download')}
                            >
                              下载
                            </Button>
                          )}
                          {record.status === 'awaiting_check' && role === 'admin' && (
                            <Popconfirm
                              title="清理原文件？安装包记录会保留。"
                              okText="清理"
                              onConfirm={() => act(record, 'remove')}
                            >
                              <Button type="link" danger loading={action === record.id + 'remove'}>
                                清理原文件
                              </Button>
                            </Popconfirm>
                          )}
                        </Flex>
                      )}
                    </List.Item>
                  )
                }}
              />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无在线安装包" />
            )}
          </>
        )}
      </HostedResource>
    </Modal>
  )
}

function sizeLabel(bytes: number): string {
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KiB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}
