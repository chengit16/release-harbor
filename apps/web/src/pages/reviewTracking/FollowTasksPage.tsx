/** @description 审核跟踪集中管理；GET 仅读取缓存，任务控制不授予任何发布写权限。 */
import { useState } from 'react'
import { Alert, Button, Card, Flex, Input, List, Select, Statistic, Tag, Typography } from 'antd'
import { channelLabels, type LocalFollow } from '@release-harbor/contracts'
import { useLocalEfficiency } from '../localSettings/useLocalEfficiency.ts'
import { useStoreStatus } from './useStoreStatus.ts'
import { controlLocalFollow } from '../../api/services/localEfficiency.ts'
import { useUrlState, updateUrlState } from '../../app/useUrlState.ts'
/** 长函数保留原因：集中列表只组合任务摘要和既有控制接口，所有调度逻辑留在服务端。
 * 任务保留固定版本、暂停原因和观察时间，绑定删除时仍可结束旧任务。 */
export function FollowTasksPage() {
  // 1. URL 筛选与本机状态分别读取，不产生商店请求。
  const local = useLocalEfficiency(),
    directory = useStoreStatus(),
    params = useUrlState()
  const [error, setError] = useState(''),
    [busy, setBusy] = useState('')
  const status = params.get('followStatus') ?? '',
    search = params.get('followSearch') ?? ''
  const follows = local.data?.state.follows ?? []
  function taskLabel(f: LocalFollow): string {
    const t = directory.response?.targets.find((t) => t.bindingId === f.bindingId)
    return t ? `${t.applicationName} · ${channelLabels[t.channel]}` : f.label
  }
  const rows = follows.filter(
    (f) =>
      (!status || f.status === status) &&
      taskLabel(f).toLowerCase().includes(search.toLowerCase()) &&
      (!directory.filters.project || f.projectId === directory.filters.project) &&
      (!directory.filters.application || f.applicationId === directory.filters.application) &&
      (!directory.filters.channel ||
        directory.response?.targets.some(
          (t) => t.bindingId === f.bindingId && t.channel === directory.filters.channel,
        )),
  )
  // 2. 防止并行控制，服务端继续核对任务指纹与状态。
  async function control(id: string, action: 'pause' | 'resume' | 'end') {
    if (busy) return
    setBusy(id)
    setError('')
    try {
      await controlLocalFollow(id, action)
      await local.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作未完成')
    } finally {
      setBusy('')
    }
  }
  // 3. 列表分别表达观察时间、调度时间与暂停原因，不把任务结束解释为已上架。
  return (
    <Flex vertical gap={16} role="region" aria-label="跟踪任务管理">
      <Alert
        type="info"
        showIcon
        title="服务运行期间只读跟踪"
        description="退出服务或电脑休眠时不查询；浏览器关闭后站内记录仍可积累，系统通知依赖页面和授权。刷新此页不会查询商店。"
      />
      {(error || local.error || directory.error) && (
        <Alert role="alert" type="error" title={error || local.error || directory.error} />
      )}
      <Flex wrap gap={16}>
        {(['active', 'paused', 'ended'] as const).map((s) => (
          <Card key={s} size="small">
            <Statistic
              title={{ active: '跟踪中', paused: '已暂停', ended: '已结束' }[s]}
              value={local.data ? follows.filter((f) => f.status === s).length : '—'}
            />
          </Card>
        ))}
      </Flex>
      <Flex wrap gap={12}>
        <Select
          aria-label="跟踪筛选项目"
          placeholder="全部项目"
          allowClear
          style={{ width: 180, maxWidth: '100%' }}
          value={directory.filters.project || undefined}
          options={[
            ...new Map(
              (directory.response?.targets ?? []).map((t) => [
                t.projectId,
                { value: t.projectId, label: t.projectName },
              ]),
            ).values(),
          ]}
          onChange={(v) => directory.filter({ project: v ?? '', application: '' })}
        />
        <Select
          aria-label="跟踪筛选应用"
          placeholder="全部应用"
          allowClear
          style={{ width: 200, maxWidth: '100%' }}
          value={directory.filters.application || undefined}
          options={[
            ...new Map(
              (directory.response?.targets ?? [])
                .filter(
                  (t) => !directory.filters.project || t.projectId === directory.filters.project,
                )
                .map((t) => [
                  t.applicationId,
                  { value: t.applicationId, label: `${t.applicationName} · ${t.platform}` },
                ]),
            ).values(),
          ]}
          onChange={(v) => directory.filter({ application: v ?? '' })}
        />
        <Select
          aria-label="跟踪筛选渠道"
          placeholder="全部渠道"
          allowClear
          style={{ width: 180, maxWidth: '100%' }}
          value={directory.filters.channel || undefined}
          options={Object.entries(channelLabels).map(([value, label]) => ({ value, label }))}
          onChange={(v) => directory.filter({ channel: v ?? '' })}
        />
        <Input
          aria-label="搜索跟踪任务"
          style={{ width: 240, maxWidth: '100%' }}
          placeholder="应用或渠道"
          value={search}
          onChange={(e) => updateUrlState({ followSearch: e.target.value })}
        />
        <Select
          aria-label="跟踪任务状态"
          placeholder="全部任务状态"
          allowClear
          value={status || undefined}
          style={{ width: 180 }}
          options={[
            { value: 'active', label: '跟踪中' },
            { value: 'paused', label: '已暂停' },
            { value: 'ended', label: '已结束' },
          ]}
          onChange={(v) => updateUrlState({ followStatus: v ?? '' })}
        />
        <Button onClick={() => void local.refresh()}>刷新任务</Button>
        <Button
          onClick={() => updateUrlState({ reviewMode: '', reviewTarget: '', reviewRecord: '' })}
        >
          选择商店开启跟踪
        </Button>
      </Flex>
      <List
        dataSource={rows}
        pagination={{ pageSize: 8 }}
        locale={{
          emptyText: local.loading ? '正在读取任务…' : '暂无匹配任务，请在商店状态详情显式开启跟踪',
        }}
        renderItem={(f) => (
          <List.Item key={f.id}>
            <Flex vertical gap={8} style={{ minWidth: 0, width: '100%' }}>
              <Flex wrap gap={8}>
                <Typography.Text strong>{taskLabel(f)}</Typography.Text>
                <Tag
                  color={
                    f.status === 'active'
                      ? 'processing'
                      : f.status === 'paused'
                        ? 'warning'
                        : 'default'
                  }
                >
                  {{ active: '跟踪中', paused: '已暂停', ended: '已结束' }[f.status]}
                </Tag>
              </Flex>
              <Typography.Text style={{ overflowWrap: 'anywhere' }}>
                {f.versionId
                  ? `版本 ID ${f.versionId}`
                  : f.buildNumber
                    ? `构建号 ${f.buildNumber}`
                    : '应用级观察，不能证明某个新包审核结果'}
              </Typography.Text>
              <Typography.Text>{f.reason}</Typography.Text>
              <Typography.Text type="secondary">
                每 {f.intervalMinutes} 分钟 ·{' '}
                {f.until === 'review' ? '跟踪至审核结果' : '跟踪至上架'} · 连续失败 {f.failures} 次
              </Typography.Text>
              <Typography.Text type="secondary">
                最近：{f.lastAt ? new Date(f.lastAt).toLocaleString() : '尚未自动查询'}（非实时） ·
                下次：{f.status === 'active' ? new Date(f.nextAt).toLocaleString() : '已停止调度'} ·
                到期：{new Date(f.expiresAt).toLocaleString()}
              </Typography.Text>
              <Flex wrap gap={8}>
                <Button
                  onClick={() =>
                    updateUrlState({
                      reviewMode: '',
                      reviewRecord: '',
                      reviewTarget: f.bindingId,
                      reviewProject: f.projectId,
                      reviewApplication: f.applicationId,
                    })
                  }
                >
                  查看商店版本
                </Button>
                {f.status !== 'ended' && (
                  <>
                    <Button
                      disabled={!!busy}
                      onClick={() => void control(f.id, f.status === 'active' ? 'pause' : 'resume')}
                    >
                      {f.status === 'active' ? '暂停跟踪' : '继续跟踪'}
                    </Button>
                    <Button disabled={!!busy} onClick={() => void control(f.id, 'end')}>
                      结束跟踪
                    </Button>
                  </>
                )}
              </Flex>
            </Flex>
          </List.Item>
        )}
      />
    </Flex>
  )
}
