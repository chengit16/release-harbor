/** @description 发布详情只读操作者关联；个人模式不发团队请求，旧事实不猜补身份。 */
import { useEffect, useState } from 'react'
import { Alert, Button, Collapse, Flex, Pagination, Typography } from 'antd'
import type { TeamAuditPage, TeamAuditTarget } from '@release-harbor/contracts'
import { useTeamIdentity } from './teamAccess.tsx'
import { teamRecordAudit } from './teamApi.ts'
import { TeamAuditList } from './TeamAuditList.tsx'

/** 当前详情的最小定位与业务刷新标记，不构成服务端访问资格。 */
interface Props {
  /** 原记录的项目与应用。 */ projectId: string
  /** 原记录应用 ID。 */ applicationId: string
  /** 单计划、批次或 Apple 意图。 */ kind: TeamAuditTarget['kind']
  /** 原记录 ID。 */ recordId: string
  /** 确认或人工核对后变化，重新读取本机日志。 */ version?: string
}
/** 准备人、确认人及后续执行阶段分开呈现，详情读取不触发商店动作。 */
export function TeamRecordAudit({ projectId, applicationId, kind, recordId, version }: Props) {
  const member = useTeamIdentity()
  const [data, setData] = useState<TeamAuditPage>()
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    if (!member) return
    const controller = new AbortController()
    setData(undefined)
    setError('')
    void teamRecordAudit(
      { projectId, applicationId, kind, recordId },
      page,
      controller.signal,
    ).then(
      (result) => {
        if (!controller.signal.aborted) setData(result)
      },
      (reason: unknown) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : '操作者读取失败')
      },
    )
    return () => controller.abort()
  }, [member, projectId, applicationId, kind, recordId, version, page, refresh])
  if (!member) return null
  return (
    <Collapse
      className="form-feedback"
      items={[
        {
          key: 'actors',
          label: '操作者与操作记录',
          children: (
            <Flex vertical gap={12}>
              <Typography.Text type="secondary">
                与原始记录匹配的操作者；旧历史未记录的身份不补填。许可和确认不等于商店受理或上架。
              </Typography.Text>
              <Button onClick={() => setRefresh((v) => v + 1)}>刷新操作记录</Button>
              {error ? (
                <Alert type="error" showIcon title={error} />
              ) : !data ? (
                <Typography.Text>正在读取操作者…</Typography.Text>
              ) : data.total ? (
                <>
                  <TeamAuditList items={data.items} />
                  <Pagination
                    current={page}
                    pageSize={50}
                    total={data.total}
                    showSizeChanger={false}
                    hideOnSinglePage
                    onChange={setPage}
                  />
                </>
              ) : (
                <Typography.Text type="secondary">
                  历史未记录：此记录没有可匹配的团队操作者。
                </Typography.Text>
              )}
            </Flex>
          ),
        },
      ]}
    />
  )
}
