/** @description 在线控制台会话与空间选择；只展示当前空间，退出后清空目录。 */
import { Alert, Button, Card, Empty, Select, Tabs, Tag, Typography } from 'antd'
import { useState } from 'react'
import type { HostedWorkspace } from '@release-harbor/contracts'
import { HttpError } from '../api/client.ts'
import { hostedDecode, hostedLoginUrl, hostedWrite } from './api.ts'
import { HostedDirectory } from './HostedDirectory.tsx'
import { HostedMembers, roleLabels } from './HostedMembers.tsx'
import { HostedResource } from './HostedResource.tsx'
import { useHostedData } from './useHostedData.ts'

/** 管理登录后的会话与空间切换；不保存会话令牌或目录到浏览器存储。 */
export function HostedConsole() {
  const session = useHostedData('/session', hostedDecode.workspaces)
  const [activeId, setActiveId] = useState<string>()
  const [isLoggingOut, setLoggingOut] = useState(false)
  const [logoutError, setLogoutError] = useState('')

  async function logout() {
    setLogoutError('')
    setLoggingOut(true)
    try {
      await hostedWrite('/auth/logout', 'POST', {})
      setActiveId(undefined)
      session.refresh()
    } catch (reason) {
      setLogoutError(reason instanceof Error ? reason.message : '退出失败')
    } finally {
      setLoggingOut(false)
    }
  }

  if (session.error instanceof HttpError && session.error.statusCode === 401)
    return <HostedSignIn />

  return (
    <HostedResource resource={session}>
      {(workspaces) => {
        const current = workspaces.find((workspace) => workspace.id === activeId) ?? workspaces[0]
        return (
          <>
            <header className="hosted-bar">
              <div className="hosted-bar-inner">
                <HarborBrand />
                <div className="hosted-header-actions">
                  {current && (
                    <Select
                      aria-label="当前工作空间"
                      value={current.id}
                      options={workspaces.map(({ id, name }) => ({ value: id, label: name }))}
                      onChange={setActiveId}
                    />
                  )}
                  <Button loading={isLoggingOut} onClick={logout}>
                    退出登录
                  </Button>
                </div>
              </div>
            </header>
            <main className="hosted-main">
              {logoutError && <Alert type="error" showIcon title={logoutError} />}
              {current ? (
                // 卸载旧空间的列表、弹窗与表单；晚到的响应不能进入新空间。
                <WorkspaceHome
                  key={current.id}
                  workspace={current}
                  onSessionChange={session.refresh}
                />
              ) : (
                <Card>
                  <Empty description="当前没有可访问的工作空间，请联系管理员确认成员权限。" />
                </Card>
              )}
            </main>
          </>
        )
      }}
    </HostedResource>
  )
}

function WorkspaceHome({
  workspace,
  onSessionChange,
}: {
  workspace: HostedWorkspace
  onSessionChange(): void
}) {
  return (
    <>
      <section className="hosted-intro" aria-label="工作空间概览">
        <Typography.Title level={1}>{workspace.name}</Typography.Title>
        <Tag color="blue">{roleLabels[workspace.role]}</Tag>
      </section>
      <Alert
        type="info"
        showIcon
        title="在线目录验证阶段"
        description="可管理应用配置和在线安装包。已接收的包仍待检查，执行器配对和发布尚未开放。"
      />
      <Tabs
        className="hosted-tabs"
        destroyOnHidden
        items={[
          {
            key: 'catalog',
            label: '项目与应用',
            children: <HostedDirectory workspace={workspace} />,
          },
          ...(workspace.role === 'admin'
            ? [
                {
                  key: 'members',
                  label: '成员',
                  children: (
                    <HostedMembers workspace={workspace} onSessionChange={onSessionChange} />
                  ),
                },
              ]
            : []),
        ]}
      />
    </>
  )
}

function HostedSignIn() {
  const [isSigningIn, setSigningIn] = useState(false)
  const [error, setError] = useState(() => {
    const status = new URLSearchParams(location.search).get('login')
    return status === 'invitation'
      ? '此身份尚未受邀加入工作空间。请联系管理员。'
      : status === 'invalid'
        ? '登录请求未完成或已过期，请重新登录。'
        : ''
  })

  async function login() {
    setSigningIn(true)
    setError('')
    try {
      location.assign(await hostedLoginUrl())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法开始登录')
      setSigningIn(false)
    }
  }

  return (
    <main className="hosted-sign-in">
      <section className="hosted-sign-in-context">
        <HarborBrand />
        <Typography.Title level={1}>在线控制台</Typography.Title>
      </section>
      <Card className="hosted-sign-in-card">
        <Typography.Title level={2}>登录工作空间</Typography.Title>
        {error && <Alert type="error" showIcon title={error} />}
        <Button type="primary" size="large" block loading={isSigningIn} onClick={login}>
          使用组织身份登录
        </Button>
      </Card>
    </main>
  )
}

function HarborBrand() {
  return (
    <div className="hosted-brand">
      <span className="hosted-brand-mark" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 12 12 6l8 6-8 6-8-6Z M4 16l8 6 8-6 M12 2v4" />
        </svg>
      </span>
      <span>Release Harbor</span>
    </div>
  )
}
