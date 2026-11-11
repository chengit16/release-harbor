/** @description 本机管理员维护成员账号；表单不持久化口令，停用会废弃成员会话。 */
import { Alert, Button, Flex, Form, Input, List, Modal, Popconfirm, Tag, Typography } from 'antd'
import { useEffect, useState } from 'react'
import type { LocalTeamMember } from '@release-harbor/contracts'
import { addTeamMember, teamMembers, updateTeamMember, type TeamCredentials } from './teamApi.ts'

/** 关闭后销毁对话框状态和未提交的成员口令。 */
interface Props {
  /** 由工作台关闭当前账号管理窗口。 */
  onClose: () => void
}

/** 管理员创建、启停成员及重置密码；现有管理员不可从页面降权。 */
export function TeamMembers({ onClose }: Props) {
  const [members, setMembers] = useState<LocalTeamMember[]>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [reset, setReset] = useState<LocalTeamMember>()
  const [version, setVersion] = useState(0)
  const [form] = Form.useForm<TeamCredentials>()

  useEffect(() => {
    const controller = new AbortController()
    void teamMembers(controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) setMembers(result)
      },
      (reason: unknown) => {
        if (!controller.signal.aborted) setError(message(reason))
      },
    )
    return () => controller.abort()
  }, [version])

  async function submit(operation: () => Promise<LocalTeamMember>) {
    setBusy(true)
    setError('')
    try {
      await operation()
      form.resetFields()
      setReset(undefined)
      setVersion((current) => current + 1)
    } catch (reason) {
      setError(message(reason))
    } finally {
      form.setFieldValue('password', undefined)
      setBusy(false)
    }
  }

  return (
    <Modal
      title="成员管理"
      open
      onCancel={onClose}
      footer={null}
      width={620}
      closable={!busy}
      mask={{ closable: !busy }}
      keyboard={!busy}
    >
      <Typography.Paragraph type="secondary">
        成员使用独立的本机账号。应用、发布和审核权限将在后续切片接入。
      </Typography.Paragraph>
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
      <List
        loading={!members && !error}
        dataSource={members ?? []}
        rowKey="id"
        renderItem={(member) => (
          <List.Item>
            <Flex gap={8} wrap align="center">
              <strong>{member.username}</strong>
              <Tag>{member.role === 'admin' ? '管理员' : member.enabled ? '已启用' : '已停用'}</Tag>
            </Flex>
            {member.role === 'member' && (
              <Flex gap={4} wrap>
                <Button
                  type="link"
                  disabled={busy}
                  onClick={() => {
                    form.resetFields()
                    setReset(member)
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
      <Typography.Title level={5}>
        {reset ? `重置 ${reset.username} 的密码` : '添加成员'}
      </Typography.Title>
      <Form
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
  )
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : '成员维护未完成'
}
