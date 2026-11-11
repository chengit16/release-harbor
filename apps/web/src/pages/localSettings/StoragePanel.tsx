/** @description 安装包空间与历史引用管理；清理回收原文件，删除限定失败／已清理记录，刷新不触发检查。 */
import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Flex,
  Input,
  List,
  Modal,
  Progress,
  Select,
  Statistic,
  Tag,
  Typography,
} from 'antd'
import type { LocalStorageView } from '@release-harbor/contracts'
import { useUrlPage } from '../../hooks/useUrlPage.ts'
import { ArtifactDeleteButton } from '../artifacts/ArtifactDeleteButton.tsx'
import { updateUrlState, useUrlState } from '../../app/useUrlState.ts'
import {
  artifactDownloadUrl,
  cleanupArtifacts,
  readLocalStorage,
} from '../../api/services/localProductivity.ts'
/** 按数量级展示容量，预算与占用共用相同二进制单位换算。 */
export function storageSize(bytes: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  const index = bytes > 0 ? Math.min(4, Math.floor(Math.log(bytes) / Math.log(1024))) : 0
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}
/** 长函数保留原因：同一筛选集合的选择、确认与两种入口共享一个视图，文件操作已放入独立服务。
 * 同一面板可限定应用；容量始终显示全局预算，避免将筛选结果误当剩余容量。 */
export function StoragePanel({
  applicationId,
  onChanged,
}: {
  /** 省略时展示全部应用。 */ applicationId?: string
  /** 清理或删除后通知原安装包列表刷新。 */ onChanged?: () => void
}) {
  // 1. 目录读取可取消，筛选变化清空选择，避免清理不可见的旧选择。
  const [data, setData] = useState<LocalStorageView>(),
    [error, setError] = useState(''),
    [operationError, setOperationError] = useState(''),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<string[]>([]),
    [confirm, setConfirm] = useState(false)
  const params = useUrlState(),
    prefix = applicationId ? 'artifactStorage' : 'storage'
  const search = params.get(`${prefix}Search`) ?? '',
    app = params.get(`${prefix}Application`) ?? '',
    status = params.get(`${prefix}Status`) ?? ''
  const rawDays = Number(params.get(`${prefix}Days`)),
    days = [7, 30].includes(rawDays) ? rawDays : 0
  function filter(patch: Record<string, string>, replace = false) {
    updateUrlState(
      Object.fromEntries(
        Object.entries({ ...patch, Page: '' }).map(([key, value]) => [`${prefix}${key}`, value]),
      ),
      replace,
    )
  }
  // 返回与前进也会改变筛选；清空临时选择和确认，避免清理旧集合中的不可见文件。
  useEffect(() => {
    setSelected([])
    setConfirm(false)
  }, [search, app, status, days, applicationId])
  useEffect(() => {
    const c = new AbortController()
    void readLocalStorage(c.signal)
      .then((v) => {
        if (!c.signal.aborted) {
          setData(v)
          setError('')
          setSelected([])
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e instanceof Error ? e.message : '存储读取失败')
      })
    return () => c.abort()
  }, [revision])
  const rows = (data?.artifacts ?? []).filter(
    (r) =>
      (!applicationId || r.applicationId === applicationId) &&
      (!app || r.applicationId === app) &&
      (!status || r.status === status) &&
      (!days || Date.parse(r.createdAt) < Date.now() - days * 86400000) &&
      `${r.fileName} ${r.version} ${r.applicationName}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  )
  const pagination = useUrlPage(`${prefix}Page`, rows.length, 8)
  const picked = (data?.artifacts ?? []).filter((r) => selected.includes(r.id))
  const selectable = rows.filter((r) => ['ready', 'failed', 'removed'].includes(r.status))
  const canCleanup = picked.length > 0 && picked.every((r) => r.sizeBytes > 0)
  const canDelete =
    picked.length > 0 && picked.every((r) => ['failed', 'removed'].includes(r.status))
  function handleDeleted() {
    setSelected([])
    setRevision((n) => n + 1)
    onChanged?.()
  }
  const labels: Record<string, string> = {
    ready: '可用',
    removed: '已清理',
    failed: '检查失败',
    receiving: '接收中',
    checking: '检查中',
  }
  // 2. 明确确认后才提交，失败刷新实际事实，不假定跨文件回滚。
  async function remove() {
    if (busy || !selected.length) return
    setBusy(true)
    setOperationError('')
    try {
      await cleanupArtifacts(selected)
      setConfirm(false)
      setRevision((n) => n + 1)
      onChanged?.()
    } catch (e) {
      setOperationError(e instanceof Error ? e.message : '清理未完成，请刷新核对')
      setConfirm(false)
      setRevision((n) => n + 1)
    } finally {
      setBusy(false)
    }
  }
  // 3. 容量、筛选、记录和确认使用同一公开目录；手机保留全部操作。
  return (
    <Flex vertical gap={16} role="region" aria-label="安装包存储管理">
      {(error || operationError) && (
        <Alert
          role="alert"
          type="error"
          title={operationError || error}
          action={<Button onClick={() => setRevision((n) => n + 1)}>重新读取存储</Button>}
        />
      )}
      <Card size="small">
        <Flex wrap gap={24}>
          <Statistic
            title="安装包占用 / 预算"
            value={data ? `${storageSize(data.usedBytes)} / ${storageSize(data.budgetBytes)}` : '—'}
          />
          <Statistic title="磁盘可用" value={data ? storageSize(data.availableBytes) : '—'} />
          <Statistic title="备份占用" value={data ? storageSize(data.backupBytes) : '—'} />
        </Flex>
        <Progress
          percent={data ? Math.min(100, Math.round((data.usedBytes / data.budgetBytes) * 100)) : 0}
        />
      </Card>
      <Alert
        type="info"
        showIcon
        title="清理原文件，保留身份、发布历史和防重复保护"
        description="准备、检查或执行期间不能清理原文件。失败或已清理项可删除记录，保留发布历史和防重复保护；再次使用需重新导入并准备。"
      />
      <Flex wrap gap={12}>
        <Input
          aria-label="搜索安装包"
          placeholder="文件名、版本或应用"
          value={search}
          style={{ width: 220, maxWidth: '100%' }}
          onChange={(e) => {
            filter({ Search: e.target.value }, true)
            setSelected([])
          }}
        />
        {!applicationId && (
          <Select
            aria-label="存储筛选应用"
            placeholder="全部应用"
            allowClear
            style={{ width: 200, maxWidth: '100%' }}
            value={app || undefined}
            onChange={(v) => {
              filter({ Application: v ?? '' })
              setSelected([])
            }}
            options={[
              ...new Map(
                (data?.artifacts ?? []).map((r) => [
                  r.applicationId,
                  { value: r.applicationId, label: r.applicationName },
                ]),
              ).values(),
            ]}
          />
        )}
        <Select
          aria-label="安装包状态"
          placeholder="全部状态"
          allowClear
          style={{ width: 150 }}
          value={status || undefined}
          onChange={(v) => {
            filter({ Status: v ?? '' })
            setSelected([])
          }}
          options={Object.entries(labels).map(([value, label]) => ({ value, label }))}
        />
        <Select
          aria-label="安装包时间"
          value={days}
          style={{ width: 160 }}
          onChange={(v) => {
            filter({ Days: v ? String(v) : '' })
            setSelected([])
          }}
          options={[
            { value: 0, label: '全部时间' },
            { value: 7, label: '七天以前' },
            { value: 30, label: '三十天以前' },
          ]}
        />
        <Button onClick={() => setRevision((n) => n + 1)} disabled={busy}>
          刷新占用
        </Button>
      </Flex>
      <Typography.Text type="secondary">
        当前筛选 {rows.length} 条 · 原文件 {storageSize(rows.reduce((n, r) => n + r.sizeBytes, 0))}
      </Typography.Text>
      <Flex wrap gap={12} align="center">
        <Checkbox
          checked={!!selectable.length && selectable.every((r) => selected.includes(r.id))}
          disabled={busy || !selectable.length}
          onChange={(e) =>
            setSelected(e.target.checked ? selectable.slice(0, 100).map((r) => r.id) : [])
          }
        >
          选择当前筛选（最多一百项）
        </Checkbox>
        <Button danger disabled={!canCleanup || busy} onClick={() => setConfirm(true)}>
          清理所选原文件
        </Button>
        <ArtifactDeleteButton
          records={picked}
          disabled={busy || !canDelete}
          label="删除所选记录"
          onChanged={handleDeleted}
        />
        <Typography.Text type="secondary">
          已选 {selected.length} 项 · {storageSize(picked.reduce((n, r) => n + r.sizeBytes, 0))}
        </Typography.Text>
      </Flex>
      <List
        dataSource={rows}
        pagination={pagination}
        locale={{ emptyText: data ? '暂无匹配安装包' : '正在读取存储…' }}
        renderItem={(r) => (
          <List.Item key={r.id}>
            <Flex vertical gap={8} style={{ width: '100%', minWidth: 0 }}>
              <Flex wrap gap={8} align="center">
                <Checkbox
                  aria-label={`选择安装包 ${r.fileName}`}
                  disabled={!['ready', 'failed', 'removed'].includes(r.status) || busy}
                  checked={selected.includes(r.id)}
                  onChange={(e) =>
                    setSelected((old) =>
                      e.target.checked
                        ? [...old, r.id].slice(0, 100)
                        : old.filter((id) => id !== r.id),
                    )
                  }
                />
                <Typography.Text strong style={{ overflowWrap: 'anywhere' }}>
                  {r.fileName}
                </Typography.Text>
                <Tag color={r.status === 'ready' ? 'success' : undefined}>
                  {labels[r.status] ?? r.status}
                </Tag>
              </Flex>
              <Typography.Text type="secondary">
                {r.applicationName} · {r.version} · {storageSize(r.sizeBytes)} ·{' '}
                {new Date(r.createdAt).toLocaleString()}
              </Typography.Text>
              <Flex wrap gap={12}>
                <Typography.Text>被 {r.references} 份计划引用</Typography.Text>
                {r.status === 'ready' && (
                  <Button
                    size="small"
                    href={artifactDownloadUrl(r.projectId, r.applicationId, r.id)}
                  >
                    下载安装包
                  </Button>
                )}
                {r.sizeBytes > 0 && (
                  <Button
                    size="small"
                    danger
                    disabled={busy}
                    onClick={() => {
                      setSelected([r.id])
                      setConfirm(true)
                    }}
                  >
                    清理原文件
                  </Button>
                )}
                {['failed', 'removed'].includes(r.status) && (
                  <ArtifactDeleteButton records={[r]} disabled={busy} onChanged={handleDeleted} />
                )}
              </Flex>
            </Flex>
          </List.Item>
        )}
      />
      <Modal
        title="确认清理安装包原文件"
        open={confirm}
        okText="确认清理原文件"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        confirmLoading={busy}
        onCancel={() => {
          if (!busy) setConfirm(false)
        }}
        onOk={() => void remove()}
      >
        <Typography.Paragraph>
          将回收 {picked.length} 个文件，共{' '}
          {storageSize(picked.reduce((n, r) => n + r.sizeBytes, 0))}，涉及{' '}
          {picked.reduce((n, r) => n + r.references, 0)}{' '}
          份历史计划引用。此操作不能撤销，备份中也不含原文件，请先下载需要保留的安装包。
        </Typography.Paragraph>
        <Alert type="warning" title="历史身份与发布保护保留；旧计划不能因此重新获得发布资格。" />
      </Modal>
    </Flex>
  )
}
