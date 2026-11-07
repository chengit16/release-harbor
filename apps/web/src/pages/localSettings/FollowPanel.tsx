/** @description 商店详情内显式只读跟踪配置；选择固定版本或明确应用级范围，不依赖发布历史。 */
import { useState } from 'react'
import { Alert, Button, Card, Flex, Input, Select, Tag, Typography } from 'antd'
import { type StoreStatusTarget, type StoreVersionStatus } from '@release-harbor/contracts'
import { useLocalEfficiency } from './useLocalEfficiency.ts'
import { startLocalFollow, controlLocalFollow } from '../../api/services/localEfficiency.ts'
const statusLabels = { active: '跟踪中', paused: '已暂停', ended: '已结束' }
/** 跟踪显示与商店状态分开，任务不会自动送审或上线。 */
export function FollowPanel({
  target,
  versions,
}: {
  /** 来自可信目录的绑定摘要。 */ target: StoreStatusTarget
  /** 已查询的官方版本，可用于明确选择。 */ versions: StoreVersionStatus[]
}) {
  const { data, error, refresh } = useLocalEfficiency()
  const [version, setVersion] = useState(''),
    [build, setBuild] = useState(''),
    [interval, setInterval] = useState<15 | 30 | 60>(30),
    [until, setUntil] = useState<'review' | 'published'>('review'),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState('')
  const follows = data?.state.follows.filter((f) => f.bindingId === target.bindingId) ?? []
  async function act(action: () => Promise<unknown>) {
    if (busy) return
    setBusy(true)
    setFailure('')
    try {
      await action()
      await refresh()
    } catch (e) {
      setFailure(e instanceof Error ? e.message : '跟踪操作未完成')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card title="审核自动跟踪" size="small" className="form-feedback">
      <Flex vertical gap={12}>
        <Typography.Text type="secondary">
          服务运行期间按间隔只读查询，默认七天到期。应用级观察不能证明某个新包的审核结果。
        </Typography.Text>
        {(failure || error) && <Alert role="alert" type="error" title={failure || error} />}
        {follows.map((f) => (
          <Card key={f.id} size="small">
            <Flex vertical gap={8}>
              <Flex wrap gap={8}>
                <Tag color={f.status === 'active' ? 'blue' : 'default'}>
                  {statusLabels[f.status]}
                </Tag>
                <Typography.Text>
                  {f.versionId
                    ? `版本 ID ${f.versionId}`
                    : f.buildNumber
                      ? `构建 ${f.buildNumber}`
                      : '应用级观察'}
                </Typography.Text>
              </Flex>
              <Typography.Text>{f.reason}</Typography.Text>
              <Typography.Text type="secondary">
                每 {f.intervalMinutes} 分钟 ·{' '}
                {f.lastAt ? `最近 ${new Date(f.lastAt).toLocaleString()}` : '尚未自动查询'} ·{' '}
                {f.status === 'active'
                  ? `下次 ${new Date(f.nextAt).toLocaleString()}`
                  : `到期 ${new Date(f.expiresAt).toLocaleString()}`}
              </Typography.Text>
              <Flex wrap gap={8}>
                {f.status !== 'ended' && (
                  <>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void act(() =>
                          controlLocalFollow(f.id, f.status === 'active' ? 'pause' : 'resume'),
                        )
                      }
                    >
                      {f.status === 'active' ? '暂停跟踪' : '继续跟踪'}
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() => void act(() => controlLocalFollow(f.id, 'end'))}
                    >
                      结束跟踪
                    </Button>
                  </>
                )}
              </Flex>
            </Flex>
          </Card>
        ))}
        <Select
          aria-label="跟踪版本"
          value={version}
          onChange={setVersion}
          options={[
            { value: '', label: '应用级观察（不限定某个新版本）' },
            ...[
              ...new Map(versions.filter((v) => v.versionId).map((v) => [v.versionId, v])).values(),
            ].map((v) => ({
              value: v.versionId ?? '',
              label: `${v.versionName ?? '未提供版本名'} · ${v.buildNumber ?? '未提供构建号'} · ${v.versionId}`,
            })),
          ]}
        />
        {target.channel === 'oppo' && !version && (
          <Input
            aria-label="审核跟踪 OPPO 构建号"
            placeholder="可选：指定 OPPO 构建号"
            value={build}
            onChange={(e) => setBuild(e.target.value)}
          />
        )}
        <Flex wrap gap={8}>
          <Select
            aria-label="跟踪查询间隔"
            value={interval}
            onChange={setInterval}
            options={[15, 30, 60].map((n) => ({ value: n, label: `每 ${n} 分钟` }))}
          />
          <Select
            aria-label="跟踪结束条件"
            value={until}
            onChange={setUntil}
            options={[
              { value: 'review', label: '到审核结果' },
              { value: 'published', label: '到确认上架' },
            ]}
          />
        </Flex>
        <Button
          type="primary"
          loading={busy}
          disabled={!data || !target.querySupported}
          onClick={() =>
            void act(() =>
              startLocalFollow({
                projectId: target.projectId,
                applicationId: target.applicationId,
                bindingId: target.bindingId,
                versionId: version || null,
                buildNumber: !version && build ? build : null,
                intervalMinutes: interval,
                until,
              }),
            )
          }
        >
          开启只读跟踪
        </Button>
      </Flex>
    </Card>
  )
}
