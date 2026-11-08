/** @description 发布页内接入安装包；上传后只轮询本机检查事实，终态通知表单重新读取选项。 */
import { useEffect, useRef } from 'react'
import { Alert, Collapse, Flex, Tag, Typography } from 'antd'
import type { Application } from '@release-harbor/contracts'
import { ArtifactUpload } from '../artifacts/ArtifactUpload.tsx'
import { useArtifacts } from '../artifacts/useArtifacts.ts'

/** 安装包刷新不能重置当前渠道、说明或上架策略草稿。 */
export function ReleaseArtifactIntake({
  application,
  onChanged,
}: {
  /** 当前发布应用。 */ application: Application
  /** 本机检查状态改变时读取发布选项，不自动准备。 */ onChanged: () => void
}) {
  const data = useArtifacts(application.projectId, application.id)
  const callback = useRef(onChanged),
    previous = useRef('')
  callback.current = onChanged
  const signature = data.records.map((item) => `${item.id}:${item.status}`).join('|')
  useEffect(() => {
    if (previous.current !== signature) {
      previous.current = signature
      callback.current()
    }
  }, [signature])
  return (
    <Collapse
      defaultActiveKey={[]}
      items={[
        {
          key: 'upload',
          label: '上传新安装包（可选）',
          children: (
            <Flex vertical gap={12}>
              <ArtifactUpload secondary application={application} onRefresh={data.refresh} />
              {data.error && <Alert role="alert" type="error" title={data.error} />}
              {data.records.slice(0, 3).map((item) => (
                <Typography.Text key={item.id} style={{ overflowWrap: 'anywhere' }}>
                  <Tag
                    color={
                      item.status === 'ready'
                        ? 'success'
                        : item.status === 'failed'
                          ? 'error'
                          : 'processing'
                    }
                  >
                    {item.status === 'ready'
                      ? '检查通过'
                      : item.status === 'failed'
                        ? '检查失败，请到安装包详情查看原因'
                        : '正在接收或检查'}
                  </Tag>
                  {item.fileName}
                </Typography.Text>
              ))}
            </Flex>
          ),
        },
      ]}
    />
  )
}
