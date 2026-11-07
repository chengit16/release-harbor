/** @description 页头通知入口；只读轮询本机记录，浏览器显示以事件 ID 去重，不补弹旧记录。 */
import { useEffect, useRef, useState } from 'react'
import { Badge, Button, Drawer, Alert } from 'antd'
import { useLocalEfficiency } from './useLocalEfficiency.ts'
import { LocalNotices } from './LocalNotices.tsx'
import { openLocalNotice } from './LocalNotices.tsx'
/** 页面运行期间尽力展示浏览器通知；没有权限时保留站内记录。 */
export function LocalNoticeBell() {
  const { data, error, refresh } = useLocalEfficiency(),
    [open, setOpen] = useState(false),
    [operationError, setOperationError] = useState('')
  const seen = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (!data) return
    if (!seen.current) {
      seen.current = new Set(data.state.notices.map((n) => n.id))
      return
    }
    // 有界保留本轮及上一轮 ID，避免长期打开页面让去重集合无限增长。
    const previous = seen.current
    seen.current = new Set(data.state.notices.map((n) => n.id))
    for (const n of data.state.notices) {
      if (previous.has(n.id)) continue
      if (
        data.state.browserNotifications &&
        !n.read &&
        'Notification' in window &&
        Notification.permission === 'granted'
      ) {
        try {
          const notice = new Notification(n.title, {
            body: data.state.showApplicationName
              ? n.detail
              : '有新的发布事项，请在 Release Harbor 查看',
            tag: n.id,
          })
          notice.onclick = () => {
            window.focus()
            openLocalNotice(n)
            notice.close()
          }
        } catch {
          /* 浏览器不支持系统展示时，站内记录仍保留。 */
        }
      }
    }
  }, [data])
  return (
    <>
      <Badge count={data?.state.notices.filter((n) => !n.read).length ?? 0} size="small">
        <Button
          aria-label="查看通知"
          onClick={() => {
            setOpen(true)
            void refresh()
          }}
        >
          通知
        </Button>
      </Badge>
      <Drawer
        extra={<Button onClick={() => setOpen(false)}>关闭通知</Button>}
        title="通知"
        open={open}
        onClose={() => setOpen(false)}
        size="large"
        styles={{ wrapper: { maxWidth: '100vw' } }}
      >
        {(error || operationError) && <Alert type="error" title={error || operationError} />}
        <LocalNotices
          notices={data?.state.notices ?? []}
          onRefresh={() => void refresh()}
          onError={setOperationError}
        />
      </Drawer>
    </>
  )
}
