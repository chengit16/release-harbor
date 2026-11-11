/** @description 本机管理员维护成员账号；表单不持久化口令，停用会废弃成员会话。 */
import {
  Alert,
  Button,
  Card,
  Flex,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Tag,
  Tabs,
  Typography,
} from 'antd'
import { useEffect, useState } from 'react'
import type { LocalTeamMember } from '@release-harbor/contracts'
import { TeamAudit } from './TeamAudit.tsx'
import { TeamPermissions } from './TeamPermissions.tsx'
import { addTeamMember, teamMembers, updateTeamMember, type TeamCredentials } from './teamApi.ts'

/** 管理员从独立菜单维护成员，创建与重置口令均在临时表单中完成。
 * 长函数保留原因：目录和账号表单共享刷新及错误状态，授权窗口已独立，口令不离开本页临时表单。 */
export function TeamMembers() {
  // 1. 独立页面读取账号目录，取消旧请求后不覆盖当前列表。
  const [editing, setEditing] = useState(false)
  const [tab, setTab] = useState('members')
  const [query, setQuery] = useState('')
  const [members, setMembers] = useState<LocalTeamMember[]>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [grantMember, setGrantMember] = useState<LocalTeamMember>()
  const [reset, setReset] = useState<LocalTeamMember>()
  const [version, setVersion] = useState(0)
  const [form] = Form.useForm<TeamCredentials>()

  useEffect(() => {
    const controller = new AbortController()
    void teamMembers(controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) {
          setMembers(result)
          setError('')
        }
      },
      (reason: unknown) => {
        if (!controller.signal.aborted) setError(message(reason))
      },
    )
    return () => controller.abort()
  }, [version])

  // 2. 成功才关闭并清理表单；错误在窗口内显示，密码在每次完成后清除。
  async function submit(operation: () => Promise<LocalTeamMember>) {
    setBusy(true)
    setError('')
    try {
      await operation()
      form.resetFields()
      setReset(undefined)
      setEditing(false)
      setVersion((current) => current + 1)
    } catch (reason) {
      setError(message(reason))
    } finally {
      form.setFieldValue('password', undefined)
      setBusy(false)
    }
  }

  // 3. 列表呈现授权摘要，创建和重置在临时对话框完成。
  return (
    <Flex vertical gap={16} className="local-team-members">
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          { key: 'members', label: '成员列表' },
          { key: 'audit', label: '操作日志' },
        ]}
      />
      {tab === 'audit' ? (
        <TeamAudit members={members ?? []} />
      ) : (
        <>
          <Flex align="center" wrap gap={12}>
            <Input.Search
              className="team-member-search"
              aria-label="搜索成员"
              placeholder="搜索登录名"
              value={query}
              allowClear
              onChange={(e) => setQuery(e.target.value)}
              styles={{ input: { minHeight: 0 } }}
            />
            <Typography.Text type="secondary">共 {members?.length ?? 0} 个账号</Typography.Text>
            <Button onClick={() => setVersion((v) => v + 1)}>刷新</Button>
            <Button
              className="team-member-create"
              type="primary"
              onClick={() => {
                setReset(undefined)
                form.resetFields()
                setEditing(true)
              }}
            >
              添加成员
            </Button>
          </Flex>
          {error && (
            <Alert
              type="error"
              showIcon
              title={error}
              action={
                <Button
                  size="small"
                  onClick={() => {
                    setError('')
                    setVersion((current) => current + 1)
                  }}
                >
                  刷新成员
                </Button>
              }
            />
          )}
          <Card styles={{ body: { paddingBlock: 0 } }}>
            <List
              loading={!members && !error}
              dataSource={
                members?.filter((m) => m.username.includes(query.trim().toLowerCase())) ?? []
              }
              rowKey="id"
              renderItem={(member) => (
                <List.Item className="team-member-row">
                  <Flex vertical gap={8} style={{ minWidth: 0, flex: 1 }}>
                    <Flex gap={8} wrap align="center">
                      <strong>{member.username}</strong>
                      <Tag>
                        {member.role === 'admin' ? '管理员' : member.enabled ? '已启用' : '已停用'}
                      </Tag>
                    </Flex>
                    {member.role === 'member' && (
                      <Typography.Text type="secondary">
                        {member.permissions?.menus.length ?? 0} 个菜单 ·{' '}
                        {member.permissions?.applications?.length ?? 0} 个应用
                        {!!member.permissions?.grants.length && ' · 含旧渠道授权'}
                      </Typography.Text>
                    )}
                  </Flex>
                  {member.role === 'member' && (
                    <Flex gap={4} wrap>
                      <Button type="link" disabled={busy} onClick={() => setGrantMember(member)}>
                        成员授权
                      </Button>
                      <Button
                        type="link"
                        disabled={busy}
                        onClick={() => {
                          form.resetFields()
                          setReset(member)
                          setEditing(true)
                        }}
                      >
                        重置密码
                      </Button>
                      <Popconfirm
                        title={member.enabled ? '停用成员并退出其所有会话？' : '重新启用此成员？'}
                        onConfirm={() =>
                          submit(() =>
                            updateTeamMember(member.id, {
                              action: member.enabled ? 'disable' : 'enable',
                            }),
                          )
                        }
                      >
                        <Button type="link" danger={member.enabled} disabled={busy}>
                          {member.enabled ? '停用' : '启用'}
                        </Button>
                      </Popconfirm>
                    </Flex>
                  )}
                </List.Item>
              )}
            />
          </Card>
        </>
      )}
      {grantMember && (
        <TeamPermissions
          member={grantMember}
          onClose={() => setGrantMember(undefined)}
          onSaved={() => setVersion((v) => v + 1)}
        />
      )}
      <Modal
        title={reset ? `重置 ${reset.username} 的密码` : '添加成员'}
        open={editing}
        onCancel={() => {
          if (!busy) {
            setEditing(false)
            form.resetFields()
            setReset(undefined)
          }
        }}
        footer={null}
        destroyOnHidden
        mask={{ closable: !busy }}
        keyboard={!busy}
        closable={!busy}
      >
        {error && <Alert type="error" showIcon title={error} className="form-feedback" />}
        <Form
          preserve={false}
          form={form}
          layout="vertical"
          disabled={busy}
          onFinish={(value) =>
            submit(() =>
              reset
                ? updateTeamMember(reset.id, { action: 'reset', password: value.password })
                : addTeamMember(value),
            )
          }
        >
          {!reset && (
            <Form.Item
              name="username"
              label="成员登录名"
              rules={[
                {
                  required: true,
                  pattern: /^[a-z][a-z0-9_.-]{2,31}$/,
                  message: '使用 3 至 32 位小写字母、数字或 ._-，以字母开头',
                },
              ]}
            >
              <Input autoComplete="off" maxLength={32} />
            </Form.Item>
          )}
          <Form.Item
            name="password"
            label={reset ? '新密码' : '初始密码'}
            rules={[{ required: true, message: '请输入密码' }]}
            extra="密码须为 12 至 128 字节。"
          >
            <Input.Password autoComplete="new-password" maxLength={128} />
          </Form.Item>
          <Flex gap={8} wrap>
            <Button type="primary" htmlType="submit" loading={busy}>
              {reset ? '保存新密码' : '创建成员'}
            </Button>
            {reset && (
              <Button
                onClick={() => {
                  form.resetFields()
                  setReset(undefined)
                }}
              >
                返回添加
              </Button>
            )}
          </Flex>
        </Form>
      </Modal>
    </Flex>
  )
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : '成员维护未完成'
}
