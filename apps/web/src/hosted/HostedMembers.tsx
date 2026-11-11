/** @description 管理员的在线成员目录；权限变更由服务端确认后重新读取。 */
import { Alert, Button, Card, Form, Input, List, Popconfirm, Select, Tag, Typography } from 'antd'
import { useState } from 'react'
import {
  hostedRoles,
  type HostedMember,
  type HostedRole,
  type HostedWorkspace,
} from '@release-harbor/contracts'
import { hostedDecode, hostedWrite, workspacePath } from './api.ts'
import { HostedForm } from './HostedForm.tsx'
import { HostedResource } from './HostedResource.tsx'
import { useHostedData } from './useHostedData.ts'

/** 在线空间角色的用户可读名称。 */
export const roleLabels: Record<HostedRole, string> = {
  admin: '管理员',
  operator: '发布操作员',
  viewer: '查看者',
}

const roleOptions = hostedRoles.map((value) => ({ value, label: roleLabels[value] }))

/** 成员维护限定在当前空间，变更可能使当前操作者失去本页权限。 */
export interface HostedMembersProps {
  /** 当前成员有管理权的工作空间。 */
  workspace: HostedWorkspace
  /** 重新确认当前会话的工作空间列表。 */
  onSessionChange(): void
}

/** 预登记成员并管理角色；不会代表身份提供方发邀请邮件。 */
export function HostedMembers({ workspace, onSessionChange }: HostedMembersProps) {
  const path = workspacePath(workspace.id) + '/members'
  const members = useHostedData(path, hostedDecode.members)
  const [editing, setEditing] = useState<HostedMember | 'new'>()
  const [removing, setRemoving] = useState<string>()
  const [error, setError] = useState('')

  async function remove(member: HostedMember) {
    setRemoving(member.id)
    setError('')
    try {
      await hostedWrite(path + '/' + member.id, 'DELETE', {})
      members.refresh()
      onSessionChange()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '撤销成员失败')
    } finally {
      setRemoving(undefined)
    }
  }

  return (
    <Card
      title="成员管理"
      extra={
        <Button type="primary" onClick={() => setEditing('new')}>
          添加成员
        </Button>
      }
    >
      <Typography.Paragraph type="secondary">
        按组织身份提供方的 subject 登记。成员使用该身份登录后，即可进入此工作空间。
      </Typography.Paragraph>
      {error && <Alert type="error" showIcon title={error} />}
      <HostedResource resource={members}>
        {(items) => (
          <List
            dataSource={items}
            rowKey="id"
            renderItem={(member) => (
              <List.Item className="hosted-member">
                <div>
                  <strong>{member.label}</strong> <Tag>{roleLabels[member.role]}</Tag>
                </div>
                <div className="hosted-member-actions">
                  <Button onClick={() => setEditing(member)}>修改角色</Button>
                  <Popconfirm
                    title="撤销此成员的空间访问？"
                    okText="撤销"
                    onConfirm={() => remove(member)}
                  >
                    <Button danger loading={removing === member.id}>
                      撤销
                    </Button>
                  </Popconfirm>
                </div>
              </List.Item>
            )}
          />
        )}
      </HostedResource>
      {editing && (
        <HostedForm
          title={editing === 'new' ? '添加成员' : '修改成员角色'}
          path={editing === 'new' ? path : path + '/' + editing.id}
          method={editing === 'new' ? 'POST' : 'PATCH'}
          initial={{ role: editing === 'new' ? 'viewer' : editing.role }}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined)
            members.refresh()
            if (editing !== 'new') onSessionChange()
          }}
        >
          {editing === 'new' && (
            <>
              <Form.Item name="label" label="显示名称" rules={[{ required: true, max: 60 }]}>
                <Input maxLength={60} />
              </Form.Item>
              <Form.Item
                name="subject"
                label="OIDC subject"
                extra="使用 IdP 为此客户端返回的稳定身份标识。"
                rules={[{ required: true, max: 255 }]}
              >
                <Input maxLength={255} autoComplete="off" />
              </Form.Item>
            </>
          )}
          <Form.Item name="role" label="角色" rules={[{ required: true }]}>
            <Select options={roleOptions} />
          </Form.Item>
        </HostedForm>
      )}
    </Card>
  )
}
