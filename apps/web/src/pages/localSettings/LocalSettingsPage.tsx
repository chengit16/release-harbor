/** @description 本机设置页面，配置备份与通知，不混入发布表单或秘密录入。 */
import { StoragePanel } from './StoragePanel.tsx'
import { RuntimePanel } from './RuntimePanel.tsx'
import { useState } from 'react'
import { Alert, Button, Card, Flex, Spin, Switch, Tabs, Typography } from 'antd'
import { useUrlState, updateUrlState } from '../../app/useUrlState.ts'
import { useLocalEfficiency } from './useLocalEfficiency.ts'
import { BackupPanel } from './BackupPanel.tsx'
import { saveLocalSettings } from '../../api/services/localEfficiency.ts'

/** 页面只读刷新；开启浏览器通知必须来自按钮点击并处理权限拒绝。 */
export function LocalSettingsPage() {
  const { data, error, loading, refresh } = useLocalEfficiency(),
    params = useUrlState()
  const [operationError, setOperationError] = useState(''),
    [saving, setSaving] = useState(false)
  async function notifications(
    enabled: boolean,
    showName = data?.state.showApplicationName ?? false,
  ) {
    if (!data || saving) return
    setSaving(true)
    setOperationError('')
    try {
      if (
        enabled &&
        (!('Notification' in window) || (await Notification.requestPermission()) !== 'granted')
      )
        throw Error('浏览器未允许通知，站内通知仍可使用')
      await saveLocalSettings({
        autoBackup: data.state.autoBackup,
        browserNotifications: enabled,
        showApplicationName: showName,
      })
      await refresh()
    } catch (e) {
      setOperationError(e instanceof Error ? e.message : '通知设置未完成')
    } finally {
      setSaving(false)
    }
  }
  return (
    <Flex vertical gap={16}>
      <Alert
        type="info"
        showIcon
        title="本机服务运行时，备份和跟踪才会执行"
        description="关闭页面后服务可继续记录站内通知；电脑休眠或退出服务后停止。浏览器通知不保证在关闭页面后推送。"
      />
      {error && (
        <Alert
          role="alert"
          type="error"
          title={error}
          action={<Button onClick={() => void refresh()}>重试</Button>}
        />
      )}
      {operationError && <Alert role="alert" type="warning" title={operationError} />}
      {loading && !data ? (
        <Spin />
      ) : (
        data && (
          <Tabs
            activeKey={
              ['backups', 'notifications', 'runtime'].includes(params.get('localTab') ?? '')
                ? (params.get('localTab') ?? 'storage')
                : 'storage'
            }
            onChange={(key) => updateUrlState({ localTab: key })}
            items={[
              { key: 'storage', label: '存储管理', children: <StoragePanel /> },
              {
                key: 'backups',
                label: '备份与恢复',
                children: <BackupPanel data={data} onRefresh={() => void refresh()} />,
              },
              {
                key: 'notifications',
                label: '通知设置',
                children: (
                  <Flex vertical gap={16}>
                    <Card title="通知设置">
                      <Flex vertical gap={16}>
                        <Flex wrap gap={12} align="center">
                          <Switch
                            aria-label="浏览器通知"
                            checked={data.state.browserNotifications}
                            loading={saving}
                            onChange={(checked) => void notifications(checked)}
                          />
                          <Typography.Text>浏览器通知（需授权）</Typography.Text>
                        </Flex>
                        <Flex wrap gap={12} align="center">
                          <Switch
                            aria-label="通知显示应用名称"
                            checked={data.state.showApplicationName}
                            disabled={saving}
                            onChange={(checked) =>
                              void notifications(data.state.browserNotifications, checked)
                            }
                          />
                          <Typography.Text>浏览器通知显示应用名称</Typography.Text>
                        </Flex>
                        <Typography.Text type="secondary">
                          通知记录统一在右上角通知入口查看，已读不等于事项已解决。
                        </Typography.Text>
                      </Flex>
                    </Card>
                  </Flex>
                ),
              },
              { key: 'runtime', label: '运行诊断', children: <RuntimePanel /> },
            ]}
          />
        )
      )}
    </Flex>
  )
}
