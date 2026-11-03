/** @description 项目公开资料表单，Ant Design 维护字段与前端校验，失败保留输入。 */
import { Alert, Button, Form, Input, Select } from 'antd'
import type { CreateProject, Project } from '@release-harbor/contracts'
import { createProject } from '../../api/services/projects.ts'
import { useSubmission } from '../../hooks/useSubmission.ts'
import { frameworkNames } from './projectConfig.ts'

/** 项目表单的生命周期回调。 */
export interface ProjectFormProps {
  /** 用户取消时关闭表单并恢复触发入口的焦点。 */
  onCancel: () => void
  /** 服务端确认写入后通知父页面。 */
  onSaved: (project: Project) => void
}

/** 创建项目不收集账号、凭据或本地源码路径。 */
export function ProjectForm({ onCancel, onSaved }: ProjectFormProps) {
  const { saving, error, submit } = useSubmission()
  return (
    <section className="form-panel" aria-labelledby="create-title">
      <div className="section-title">
        <h2 id="create-title">建立项目空间</h2>
        <Button type="text" disabled={saving} onClick={onCancel}>
          取消
        </Button>
      </div>
      <Form<CreateProject>
        name="project"
        layout="vertical"
        disabled={saving}
        initialValues={{ framework: 'react-native' }}
        onFinish={(input) => void submit((signal) => createProject(input, signal), onSaved)}
      >
        <div className="antd-form-grid">
          <Form.Item
            label="项目名称"
            name="name"
            rules={[{ required: true, whitespace: true, max: 60 }]}
          >
            <Input autoFocus maxLength={60} />
          </Form.Item>
          <Form.Item
            label="项目标识"
            name="key"
            rules={[
              {
                required: true,
                pattern: /^[a-z][a-z0-9-]{1,39}$/,
                message: '需为 2–40 位小写字母、数字或短横线，并以字母开头',
              },
            ]}
          >
            <Input maxLength={40} />
          </Form.Item>
          <Form.Item label="技术栈" name="framework" rules={[{ required: true }]}>
            <Select
              options={Object.entries(frameworkNames).map(([value, label]) => ({ value, label }))}
            />
          </Form.Item>
          <Form.Item label="项目说明" name="description" rules={[{ max: 300 }]}>
            <Input maxLength={300} />
          </Form.Item>
        </div>
        {error && (
          <Alert role="alert" type="error" title={error} showIcon className="form-feedback" />
        )}
        <div className="form-bottom">
          <span>这里只保存项目公开资料，无需商店密码或安装包。</span>
          <Button type="primary" loading={saving} htmlType="submit">
            创建项目
          </Button>
        </div>
      </Form>
    </section>
  )
}
