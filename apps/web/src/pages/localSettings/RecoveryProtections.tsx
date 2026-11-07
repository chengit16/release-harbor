/** @description 恢复范围之外的发布保护记录；人工核对只附加声明，不改写原回执或发起执行。 */
import { useEffect, useState } from 'react'
import { Alert, Button, Card, Flex, List, Popconfirm, Tag, Typography } from 'antd'
import type { RecoveryProtection } from '@release-harbor/contracts'
import {
  readRecoveryProtections,
  reconcileRecoveryProtection,
} from '../../api/services/localEfficiency.ts'
/** 恢复后的未知结果可在页面核对，已受理版本保护不能被普通恢复删除。 */
export function RecoveryProtections() {
  const [items, setItems] = useState<RecoveryProtection[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void readRecoveryProtections()
      .then((v) => {
        if (!controller.signal.aborted) setItems(v)
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : '保护记录读取失败')
      })
    return () => controller.abort()
  }, [])
  async function reconcile(record: RecoveryProtection, decision: 'present' | 'absent') {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await reconcileRecoveryProtection(record, decision)
      setItems(await readRecoveryProtections())
    } catch (e) {
      setError(e instanceof Error ? e.message : '核对未完成')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card title="发布保护记录">
      <Typography.Paragraph type="secondary">
        恢复备份不会移除这些事实。仅结果不明的记录允许追加人工核对；确认不存在前，请在官方后台核对应用、版本、安装包及处理中任务。
      </Typography.Paragraph>
      {error && <Alert role="alert" type="error" title={error} />}
      <List
        pagination={{ pageSize: 5 }}
        locale={{ emptyText: '暂无远端写入保护记录' }}
        dataSource={items}
        renderItem={(r) => (
          <List.Item>
            <Flex vertical gap={8} style={{ minWidth: 0, width: '100%' }}>
              <Flex wrap gap={8}>
                <Typography.Text strong>
                  {r.applicationName} · {r.channel}
                </Typography.Text>
                <Tag color={r.unknown && !r.decision ? 'orange' : 'default'}>
                  {r.decision === 'absent'
                    ? '人工确认不存在'
                    : r.decision === 'present'
                      ? '已受理／人工确认存在'
                      : '待核对'}
                </Tag>
              </Flex>
              <Typography.Text style={{ overflowWrap: 'anywhere' }}>
                商店目标 {r.appId} · 版本 {r.versionName} · 构建 {r.buildNumber}
              </Typography.Text>
              {r.unknown && !r.decision && (
                <Flex wrap gap={8}>
                  {(['present', 'absent'] as const).map((d) => (
                    <Popconfirm
                      key={d}
                      title={
                        d === 'present'
                          ? '确认商店已存在对应操作？'
                          : '确认商店不存在且无处理中任务？'
                      }
                      description="仅追加人工声明，原回执不变，不会自动执行。"
                      onConfirm={() => reconcile(r, d)}
                      okText="确认记录"
                      cancelText="取消"
                    >
                      <Button disabled={busy}>
                        {d === 'present' ? '记录已存在' : '记录不存在'}
                      </Button>
                    </Popconfirm>
                  ))}
                </Flex>
              )}
            </Flex>
          </List.Item>
        )}
      />
    </Card>
  )
}
