/** @description 团队工作台页头显示身份并安全退出；成员维护统一在独立菜单。 */
import { Alert, Button, Flex } from 'antd'
import { useState } from 'react'

/** 页头身份及退出回调；成员维护统一在独立菜单。 */
interface Props {
  /** 当前登录名，仅用于显示。 */
  username: string
  /** 成功撤销本机账号会话后关闭业务壳。 */
  onLogout: () => Promise<void>
}

/** 提供身份显示和退出；退出失败会显示并保留当前会话。 */
export function TeamControls({ username, onLogout }: Props) {
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
      <Button size="small" loading={busy} onClick={() => void logout()}>
        退出登录
      </Button>
      {error && <Alert type="error" showIcon title={error} />}
    </Flex>
  )
}
