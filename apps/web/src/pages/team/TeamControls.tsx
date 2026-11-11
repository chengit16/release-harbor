/** @description 团队工作台页头的管理入口和安全退出；普通成员仅显示身份与退出。 */
import { Alert, Button, Flex } from 'antd'
import { useState } from 'react'
import { TeamMembers } from './TeamMembers.tsx'

/** 身份决定管理入口的可见性；服务端仍独立核对每次请求。 */
interface Props {
  /** 当前登录名，仅用于显示。 */
  username: string
  /** 普通成员不挂载管理目录。 */
  administrator?: boolean
  /** 成功撤销本机账号会话后关闭业务壳。 */
  onLogout: () => Promise<void>
}

/** 提供成员管理和退出；退出失败会显示并保留当前会话。 */
export function TeamControls({ username, onLogout, administrator = true }: Props) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function logout() {
    setBusy(true)
    setError('')
    try {
      await onLogout()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '退出失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Flex gap={8} wrap align="center">
      <span>{username}</span>
      {administrator && (
        <Button size="small" onClick={() => setOpen(true)}>
          成员管理
        </Button>
      )}
      <Button size="small" loading={busy} onClick={() => void logout()}>
        退出登录
      </Button>
      {administrator && open && <TeamMembers onClose={() => setOpen(false)} />}
      {error && <Alert type="error" showIcon title={error} />}
    </Flex>
  )
}
