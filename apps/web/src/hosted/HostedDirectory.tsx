/** @description 当前工作空间的项目与应用目录；切换父级时卸载对应草稿和读取。 */
import { Button, Card, Empty, Form, Input, List, Select, Tag, Typography } from 'antd'
import { useState } from 'react'
import {
  frameworks,
  type Application,
  type HostedWorkspace,
  type Project,
} from '@release-harbor/contracts'
import { hostedDecode, workspacePath } from './api.ts'
import { HostedForm } from './HostedForm.tsx'
import { HostedResource } from './HostedResource.tsx'
import { useHostedData } from './useHostedData.ts'

/** 在线目录只接收当前工作空间，权限提示来自服务端返回的角色。 */
export interface HostedDirectoryProps {
  /** 当前已选空间。 */
  workspace: HostedWorkspace
}

const frameworkLabels = {
  'react-native': 'React Native',
  flutter: 'Flutter',
  native: '原生',
  other: '其他',
}

/** 项目列表和同空间应用详情；服务端仍独立验证每次读写。 */
export function HostedDirectory({ workspace }: HostedDirectoryProps) {
  const path = workspacePath(workspace.id) + '/projects'
  const projects = useHostedData(path, hostedDecode.projects)
  const [projectId, setProjectId] = useState<string>()
  const [adding, setAdding] = useState(false)
  const canManage = workspace.role === 'admin'

  return (
    <>
      <HostedResource resource={projects}>
        {(items) => {
          const selected = items.find((project) => project.id === projectId) ?? items[0]
          return (
            <div className="hosted-directory">
              <Card
                title="项目"
                extra={canManage && <Button onClick={() => setAdding(true)}>新建项目</Button>}
              >
                {items.length ? (
                  <div className="hosted-projects" role="group" aria-label="项目列表">
                    {items.map((project) => (
                      <Button
                        key={project.id}
                        type={project.id === selected?.id ? 'primary' : 'text'}
                        aria-pressed={project.id === selected?.id}
                        onClick={() => setProjectId(project.id)}
                      >
                        {project.name}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有项目" />
                )}
              </Card>
              {selected ? (
                <HostedApplications
                  key={selected.id}
                  path={path}
                  project={selected}
                  canManage={canManage}
                />
              ) : (
                <Card>
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="建立项目后即可登记 Android 应用"
                  />
                </Card>
              )}
            </div>
          )
        }}
      </HostedResource>
      {adding && (
        <HostedForm
          title="新建项目"
          path={path}
          initial={{ framework: 'native' }}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false)
            projects.refresh()
          }}
        >
          <Form.Item name="name" label="项目名称" rules={[{ required: true, max: 60 }]}>
            <Input maxLength={60} />
          </Form.Item>
          <Form.Item
            name="key"
            label="项目标识"
            rules={[
              {
                required: true,
                pattern: /^[a-z][a-z0-9-]{1,39}$/,
                message: '使用 2–40 位小写字母、数字或短横线，并以字母开头',
              },
            ]}
          >
            <Input placeholder="例如 mobile-app" maxLength={40} />
          </Form.Item>
          <Form.Item name="framework" label="技术栈" rules={[{ required: true }]}>
            <Select
              options={frameworks.map((value) => ({ value, label: frameworkLabels[value] }))}
            />
          </Form.Item>
          <Form.Item name="description" label="项目说明">
            <Input.TextArea maxLength={300} rows={2} />
          </Form.Item>
        </HostedForm>
      )}
    </>
  )
}

function HostedApplications({
  path,
  project,
  canManage,
}: {
  path: string
  project: Project
  canManage: boolean
}) {
  const appPath = path + '/' + project.id + '/applications'
  const applications = useHostedData(appPath, hostedDecode.applications)
  const [adding, setAdding] = useState(false)

  return (
    <Card
      title={project.name}
      extra={
        canManage && (
          <Button type="primary" onClick={() => setAdding(true)}>
            登记应用
          </Button>
        )
      }
    >
      <div className="hosted-project-meta">
        <Tag>{frameworkLabels[project.framework]}</Tag>
        <Typography.Text type="secondary">{project.key}</Typography.Text>
      </div>
      {project.description && <Typography.Paragraph>{project.description}</Typography.Paragraph>}
      <HostedResource resource={applications}>
        {(items) =>
          items.length ? (
            <List
              dataSource={items}
              rowKey="id"
              renderItem={(application) => (
                <List.Item>
                  <HostedBinding
                    key={application.id}
                    app={application}
                    path={appPath}
                    canManage={canManage}
                  />
                </List.Item>
              )}
            />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="此项目还没有 Android 应用" />
          )
        }
      </HostedResource>
      {adding && (
        <HostedForm
          title="登记 Android 应用"
          path={appPath}
          prepare={(values) => ({ ...values, platform: 'android' })}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false)
            applications.refresh()
          }}
        >
          <Form.Item name="name" label="应用名称" rules={[{ required: true, max: 60 }]}>
            <Input maxLength={60} />
          </Form.Item>
          <Form.Item name="identifier" label="Android 包名" rules={[{ required: true, max: 255 }]}>
            <Input placeholder="例如 com.example.app" maxLength={255} />
          </Form.Item>
        </HostedForm>
      )}
    </Card>
  )
}

function HostedBinding({
  app,
  path,
  canManage,
}: {
  app: Application
  path: string
  canManage: boolean
}) {
  const bindingPath = path + '/' + app.id + '/bindings'
  const bindings = useHostedData(bindingPath, hostedDecode.bindings)
  const [editing, setEditing] = useState(false)
  const binding = bindings.data?.[0]

  return (
    <div className="hosted-binding">
      <div className="hosted-binding-title">
        <strong>{app.name}</strong>
        <Tag>Android</Tag>
      </div>
      <Typography.Text type="secondary">{app.identifier}</Typography.Text>
      <HostedResource resource={bindings}>
        {() => (
          <div className="hosted-channel">
            <div>
              <div>华为 AppGallery</div>
              {binding ? (
                <Typography.Text type="secondary">
                  {binding.appId} · {binding.credentialReference} · 未核验
                </Typography.Text>
              ) : (
                <Typography.Text type="secondary">未配置</Typography.Text>
              )}
            </div>
            {canManage && (
              <Button onClick={() => setEditing(true)}>{binding ? '编辑绑定' : '配置绑定'}</Button>
            )}
          </div>
        )}
      </HostedResource>
      {editing && (
        <HostedForm
          title="华为 Android 绑定"
          path={binding ? bindingPath + '/' + binding.id : bindingPath}
          method={binding ? 'PATCH' : 'POST'}
          initial={
            binding && { appId: binding.appId, credentialReference: binding.credentialReference }
          }
          prepare={(values) =>
            binding
              ? { ...values, expectedRevision: binding.revision }
              : { ...values, channel: 'huawei' }
          }
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false)
            bindings.refresh()
          }}
        >
          <Form.Item
            name="appId"
            label="商店 App ID"
            rules={[{ required: true, pattern: /^\d+$/, message: '请填写数字 App ID' }]}
          >
            <Input inputMode="numeric" maxLength={128} />
          </Form.Item>
          <Form.Item
            name="credentialReference"
            label="凭据引用"
            extra="只填写执行器侧账号别名。保存后仍为未核验。"
            rules={[{ required: true, max: 64 }]}
          >
            <Input maxLength={64} />
          </Form.Item>
        </HostedForm>
      )}
    </div>
  )
}
