/** @description 平台应用创建表单，平台身份创建后固定，前端校验与真实产物检查分别进行。 */
import { useState } from 'react'
import { Alert, Button, Form, Input, Select } from 'antd'
import type { Application, ApplicationPlatform, CreateApplication } from '@release-harbor/contracts'
import { createApplication } from '../../api/services/applications.ts'
import { useSubmission } from '../../hooks/useSubmission.ts'

/** 应用创建的上下文与生命周期。 */
export interface ApplicationFormProps {
  /** 资源定位，不构成授权。 */
  projectId: string
  /** 取消时关闭并恢复新建按钮焦点。 */
  onCancel: () => void
  /** 服务端保存成功后刷新列表并定位新应用。 */
  onSaved: (application: Application) => void
}

/** 使用 Ant Design 管理字段；不收集商店 appId 或秘密。 */
export function ApplicationForm({ projectId, onCancel, onSaved }: ApplicationFormProps) {
  const [platform, setPlatform] = useState<ApplicationPlatform>('android')
  const { saving, error, submit } = useSubmission()
  return (
    <section className="form-panel" aria-labelledby="application-form-title">
      <div className="section-title">
        <h3 id="application-form-title">登记平台应用</h3>
        <Button type="text" disabled={saving} onClick={onCancel}>
          取消
        </Button>
      </div>
      <Form<CreateApplication>
        name="application"
        layout="vertical"
        disabled={saving}
        initialValues={{ platform: 'android' }}
        onFinish={(input) =>
          void submit((signal) => createApplication(projectId, input, signal), onSaved)
        }
      >
        <div className="antd-form-grid">
          <Form.Item
            label="应用名称"
            name="name"
            rules={[{ required: true, whitespace: true, max: 60 }]}
          >
            <Input autoFocus maxLength={60} />
          </Form.Item>
          <Form.Item label="应用平台" name="platform" rules={[{ required: true }]}>
            <Select<ApplicationPlatform>
              onChange={setPlatform}
              options={[
                { value: 'android', label: 'Android' },
                { value: 'ios', label: 'iOS' },
                { value: 'harmony', label: 'HarmonyOS' },
              ]}
            />
          </Form.Item>
          <Form.Item
            className="wide-field"
            label={
              platform === 'android'
                ? 'Android 包名'
                : platform === 'harmony'
                  ? 'HarmonyOS Bundle Name'
                  : 'iOS Bundle ID'
            }
            name="identifier"
            extra="填写现有安装包的真实身份；创建后不可修改平台与包身份。"
            rules={[{ required: true, whitespace: true, max: 255 }]}
          >
            <Input maxLength={255} placeholder="com.example.app" spellCheck={false} />
          </Form.Item>
        </div>
        {error && (
          <Alert role="alert" type="error" title={error} showIcon className="form-feedback" />
        )}
        <div className="form-bottom">
          <span>登记不代表产物已检查，也不会连接商店。</span>
          <Button type="primary" htmlType="submit" loading={saving}>
            创建应用
          </Button>
        </div>
      </Form>
    </section>
  )
}
