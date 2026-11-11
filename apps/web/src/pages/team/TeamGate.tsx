/** @description 原工作台的会话入口；身份尚不明确时不挂载业务页面或请求其数据。 */
import { Alert, Button, Card, Form, Input, Spin, Typography } from 'antd'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { LocalTeamMember, LocalTeamSession } from '@release-harbor/contracts'
import { clearPublicDrafts } from '../../hooks/usePublicDraft.ts'
import { HttpError } from '../../api/client.ts'
import { BrandMark } from '../../components/BrandMark.tsx'
import { signInTeam, signOutTeam, teamSession, type TeamCredentials } from './teamApi.ts'
import './team.css'

/** 团队成员按权限挂载原页面；个人模式不展示成员控制。 */
interface TeamGateProps {
  /** 仅在服务端确认身份与菜单资格后渲染业务壳。 */
  render: (member?: LocalTeamMember, onLogout?: () => Promise<void>) => ReactNode
}

/** 统一处理登录、退出与会话失效；无菜单成员不挂载业务页面。 */
export function TeamGate({ render }: TeamGateProps) {
  const [state, setState] = useState<LocalTeamSession>()
  const [loadError, setLoadError] = useState('')
  const [version, setVersion] = useState(0)
  const [pending, setPending] = useState(false)
  const [formError, setFormError] = useState('')
  const [form] = Form.useForm<TeamCredentials>()
  const generation = useRef(0)
  const scope = useRef('')

  useEffect(() => {
    const controller = new AbortController()
    const revision = ++generation.current
    void teamSession(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted && revision === generation.current) {
          const nextScope =
            value.mode === 'signed_in'
              ? `${value.member.id}:${value.member.permissions?.revision ?? 0}`
              : value.mode
          if (scope.current && scope.current !== nextScope) clearPageState()
          scope.current = nextScope
          setState(value)
          setLoadError('')
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && revision === generation.current) {
          setState(undefined)
          setLoadError(message(error))
        }
      })
    return () => controller.abort()
  }, [version])

  useEffect(() => {
    function lostSession() {
      generation.current++
      clearPageState()
      setState((current) => (current?.mode === 'signed_in' ? { mode: 'signed_out' } : current))
      setVersion((current) => current + 1)
    }
    function refresh() {
      setVersion((current) => current + 1)
    }
    window.addEventListener('release-harbor-session-expired', lostSession)
    window.addEventListener('focus', refresh)
    return () => {
      window.removeEventListener('release-harbor-session-expired', lostSession)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  async function login(value: TeamCredentials) {
    setPending(true)
    setFormError('')
    try {
      await signInTeam(value)
      clearPageState()
      // 状态读取统一按代次应用，避免窗口焦点触发的旧响应覆盖登录结果。
      generation.current++
      setVersion((current) => current + 1)
    } catch (error) {
      setFormError(message(error))
    } finally {
      form.setFieldValue('password', undefined)
      setPending(false)
    }
  }

  async function logout() {
    setPending(true)
    setFormError('')
    try {
      await signOutTeam()
      clearPageState()
      generation.current++
      setState({ mode: 'signed_out' })
    } catch (error) {
      if (error instanceof HttpError && error.statusCode === 401) {
        generation.current++
        clearPageState()
        setState({ mode: 'signed_out' })
      } else throw error
    } finally {
      setPending(false)
    }
  }

  if (state?.mode === 'personal') return render()
  if (
    state?.mode === 'signed_in' &&
    (state.member.role === 'admin' || state.member.permissions?.menus.length)
  )
    return render(state.member, logout)

  return (
    <main className="local-team-entry">
      <Card className="local-team-entry-card">
        <div className="local-team-entry-brand">
          <BrandMark /> Release Harbor
        </div>
        <Typography.Title level={1}>本机团队工作台</Typography.Title>
        {loadError ? (
          <Alert
            type="error"
            showIcon
            title={loadError}
            action={<Button onClick={() => setVersion((current) => current + 1)}>重试</Button>}
          />
        ) : state?.mode === 'signed_in' ? (
          <>
            <Alert
              type="info"
              showIcon
              title={`已登录：${state.member.username}`}
              description="暂无可用菜单，请联系管理员分配应用渠道和操作权限，然后刷新页面。"
            />
            <Button
              className="local-team-entry-action"
              loading={pending}
              onClick={() => void logout().catch((e: unknown) => setFormError(message(e)))}
            >
              退出登录
            </Button>
            {formError && <Alert type="error" title={formError} />}
          </>
        ) : state?.mode === 'signed_out' ? (
          <Form form={form} layout="vertical" onFinish={login} disabled={pending}>
            {formError && <Alert type="error" showIcon title={formError} />}
            <Form.Item
              name="username"
              label="登录名"
              rules={[{ required: true, message: '请输入登录名' }]}
            >
              <Input autoComplete="username" maxLength={32} />
            </Form.Item>
            <Form.Item
              name="password"
              label="密码"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password autoComplete="current-password" maxLength={128} />
            </Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              block
              loading={pending}
              autoInsertSpace={false}
            >
              登录
            </Button>
          </Form>
        ) : (
          <div role="status">
            <Spin /> 正在检查本机会话…
          </div>
        )}
      </Card>
    </main>
  )
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : '无法完成本机团队操作'
}

// 团队账号切换清理本标签页的导航草稿，避免下一位成员恢复前一人的未保存内容。
function clearPageState(): void {
  clearPublicDrafts()
  window.history.replaceState(null, '', window.location.href)
}
