/** @description 本机诊断与可操作指引；仅探测本机工具和缓存事实，浏览器通知测试由用户点击。 */
import { useEffect, useState } from 'react'
import { Alert, Button, Card, Flex, List, Tag, Typography } from 'antd'
import type { RuntimeCheck } from '@release-harbor/contracts'
import { readRuntimeChecks } from '../../api/services/localProductivity.ts'
import { updateUrlState } from '../../app/useUrlState.ts'
/** 工具存在不等于实际执行或商店权限通过；通知测试失败不改设置。 */
export function RuntimePanel() {
  const [items, setItems] = useState<RuntimeCheck[]>([]),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0),
    [result, setResult] = useState('')
  useEffect(() => {
    const c = new AbortController()
    void readRuntimeChecks(c.signal)
      .then((v) => {
        if (!c.signal.aborted) {
          setItems(v)
          setError('')
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e instanceof Error ? e.message : '诊断未完成')
      })
    return () => c.abort()
  }, [revision])
  function testNotice() {
    try {
      if (!('Notification' in window)) throw Error('浏览器不支持系统通知，站内通知仍可用')
      if (Notification.permission !== 'granted')
        throw Error('浏览器尚未允许通知，请先到通知设置开启并授权')
      const n = new Notification('Release Harbor 测试通知', {
        body: '这是一条本机测试通知，不代表商店状态变化',
      })
      setTimeout(() => n.close(), 8000)
      setResult('已尝试发送测试通知，请检查系统通知中心和勿扰设置。')
    } catch (e) {
      setResult(e instanceof Error ? e.message : '通知测试未完成')
    }
  }
  return (
    <Flex vertical gap={16}>
      {error && <Alert role="alert" type="error" title={error} />}
      <Flex wrap gap={12}>
        <Button onClick={() => setRevision((n) => n + 1)}>重新检查运行状态</Button>
        <Button onClick={testNotice}>发送测试通知</Button>
        <Button onClick={() => updateUrlState({ localTab: 'notifications' })}>前往通知设置</Button>
      </Flex>
      {result && <Alert role="status" type="info" title={result} />}
      <Card>
        <List
          dataSource={items}
          locale={{ emptyText: '尚无诊断结果' }}
          renderItem={(r) => (
            <List.Item>
              <Flex vertical gap={8}>
                <Flex wrap gap={8}>
                  <Typography.Text strong>{r.label}</Typography.Text>
                  <Tag
                    color={
                      r.state === 'ready'
                        ? 'success'
                        : r.state === 'attention'
                          ? 'warning'
                          : 'error'
                    }
                  >
                    {r.state === 'ready' ? '可用' : r.state === 'attention' ? '需要关注' : '不可用'}
                  </Tag>
                </Flex>
                <Typography.Text>{r.detail}</Typography.Text>
                {r.key === 'tracking' && (
                  <Button
                    onClick={() =>
                      updateUrlState({
                        view: 'reviews',
                        reviewMode: 'follows',
                        reviewRecord: '',
                        reviewTarget: '',
                      })
                    }
                  >
                    查看跟踪任务
                  </Button>
                )}
                {['storage', 'backup'].includes(r.key) && (
                  <Button
                    onClick={() =>
                      updateUrlState({ localTab: r.key === 'storage' ? 'storage' : 'backups' })
                    }
                  >
                    {r.key === 'storage' ? '前往存储管理' : '前往备份与恢复'}
                  </Button>
                )}
              </Flex>
            </List.Item>
          )}
        />
      </Card>
    </Flex>
  )
}
