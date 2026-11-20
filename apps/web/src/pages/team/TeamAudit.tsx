/** @description 管理员日志入口，服务端分页筛选；刷新仅访问本机安全事件，不请求商店。 */
import { useEffect, useState } from 'react'
import { Alert, Button, Card, DatePicker, Flex, Pagination, Select } from 'antd'
import {
  teamAuditActions,
  type LocalTeamMember,
  type TeamAuditFilter,
  type TeamAuditPage,
  type TeamGrantOption,
} from '@release-harbor/contracts'
import { TeamAuditList } from './TeamAuditList.tsx'
import { teamAudit, teamGrantOptions } from './teamApi.ts'

/** 管理员只读操作历史；被停用成员仍可作为日志筛选条件。 */
export function TeamAudit({ members }: { /** 当前安装账号目录。 */ members: LocalTeamMember[] }) {
  const [filter, setFilter] = useState<TeamAuditFilter>({ page: 1 })
  const [data, setData] = useState<TeamAuditPage>()
  const [options, setOptions] = useState<TeamGrantOption[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setData(undefined)
    setError('')
    void Promise.all([
      teamAudit(filter, controller.signal),
      teamGrantOptions(controller.signal),
    ]).then(
      ([result, apps]) => {
        if (!controller.signal.aborted) {
          setData(result)
          setOptions(apps)
          setLoading(false)
        }
      },
      (reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : '日志读取失败')
          setLoading(false)
        }
      },
    )
    return () => controller.abort()
  }, [filter, version])
  function change(value: Partial<TeamAuditFilter>): void {
    setFilter((current) => ({ ...current, ...value, page: 1 }))
  }
  const apps = options.filter(
    (o, i) => options.findIndex((p) => p.applicationId === o.applicationId) === i,
  )
  return (
    <Flex vertical gap={16}>
      <Flex wrap gap={12} className="team-audit-filters">
        <Select
          className="team-audit-choice"
          aria-label="按成员筛选日志"
          placeholder="操作者或目标成员"
          allowClear
          value={filter.memberId}
          options={members.map((m) => ({ value: m.id, label: m.username }))}
          onChange={(memberId) => change({ memberId })}
        />
        <Select
          className="team-audit-choice"
          aria-label="按应用筛选日志"
          placeholder="全部应用"
          allowClear
          value={filter.applicationId}
          options={apps.map((o) => ({ value: o.applicationId, label: o.label }))}
          onChange={(applicationId) => change({ applicationId })}
        />
        <Select
          className="team-audit-choice"
          aria-label="按操作筛选日志"
          placeholder="全部操作"
          allowClear
          value={filter.action}
          options={Object.entries(teamAuditActions).map(([value, label]) => ({ value, label }))}
          onChange={(action) => change({ action })}
        />
        <DatePicker.RangePicker
          className="team-audit-time"
          aria-label="按时间筛选日志"
          onChange={(dates) =>
            change({
              from: dates?.[0]?.startOf('day').toISOString(),
              to: dates?.[1]?.endOf('day').toISOString(),
            })
          }
        />
        <Button onClick={() => setVersion((v) => v + 1)} loading={loading}>
          刷新日志
        </Button>
      </Flex>
      {error && <Alert type="error" showIcon title={error} />}
      <Card styles={{ body: { paddingBlock: 0 } }}>
        <TeamAuditList items={data?.items ?? []} loading={loading} options={options} />
      </Card>
      {data && (
        <Pagination
          current={data.page}
          total={data.total}
          pageSize={50}
          showSizeChanger={false}
          hideOnSinglePage
          onChange={(page) => setFilter((current) => ({ ...current, page }))}
        />
      )}
    </Flex>
  )
}
