/** @description 首次应用配置向导，逐步保存公开身份和渠道；失败保稿，凭据录入复用独立本机边界。 */
import { useRef, useState } from 'react'
import { Alert, Button, Flex, Form, Input, Select, Steps, Typography } from 'antd'
import type { Application, ApplicationPlatform, Project } from '@release-harbor/contracts'
import { createApplication } from '../../api/services/applications.ts'
import { createProject } from '../../api/services/projects.ts'
import { usePublicDraft } from '../../hooks/usePublicDraft.ts'
import { useSubmission } from '../../hooks/useSubmission.ts'
import { BindingsPanel } from '../applications/BindingsPanel.tsx'
import { ApplicationReadiness } from './ApplicationReadiness.tsx'

/** 向导只持有非秘密资料；平台与包身份创建后固定。
 * 长函数保留原因：步骤间复用已保存身份与顺序创建状态，渠道和就绪检查已独立，失败草稿保持同一表单生命周期。 */
export function ApplicationSetup({
  projects,
  onCreated,
  onClose,
  onOpen,
}: {
  /** 现有项目供可选归类；未选择时创建默认分组。 */ projects: Project[]
  /** 身份写入后刷新壳层目录，不关闭向导。 */ onCreated: () => void
  /** 关闭不删除已保存的应用和渠道。 */ onClose: () => void
  /** 完成后进入该应用配置。 */ onOpen: (projectId: string, applicationId: string) => void
}) {
  const [step, setStep] = useState(0),
    [application, setApplication] = useState<Application>()
  const createdGroup = useRef<Project | null>(null)
  const { saving, error, submit } = useSubmission()
  const draft = usePublicDraft('application:setup', ['name', 'platform', 'identifier', 'projectId'])
  const [platform, setPlatform] = useState<ApplicationPlatform>(() => {
    const saved = draft.initialValues?.platform
    return saved === 'ios' || saved === 'harmony' ? saved : 'android'
  })
  return (
    <section className="form-panel" aria-label="应用配置向导">
      <Flex justify="space-between" gap={12} align="center">
        <Typography.Title level={2} style={{ fontSize: 20 }}>
          新建应用
        </Typography.Title>
        <Button
          disabled={saving}
          onClick={() => {
            draft.clear()
            if (application) onOpen(application.projectId, application.id)
            else onClose()
          }}
        >
          {application ? '稍后继续' : '取消'}
        </Button>
      </Flex>
      <Steps
        current={step}
        className="onboarding-steps"
        items={[{ title: '应用信息' }, { title: '渠道配置' }, { title: '就绪检查' }]}
      />
      {application && (
        <Typography.Paragraph type="secondary">
          {application.name} · {application.identifier}
        </Typography.Paragraph>
      )}
      {step === 0 && (
        <Form
          layout="vertical"
          scrollToFirstError={{ focus: true }}
          onValuesChange={(_, values) => draft.save(values)}
          disabled={saving}
          initialValues={{
            platform: 'android',
            projectId: projects[0]?.id,
            ...draft.initialValues,
          }}
          onFinish={(values: {
            name: string
            identifier: string
            platform: ApplicationPlatform
            projectId?: string
          }) =>
            void submit(
              async (signal) => {
                // 1. 项目只是归属分组；应用创建失败后复用已经落盘的分组，避免产生重复项目。
                let projectId = values.projectId || createdGroup.current?.id
                if (!projectId) {
                  createdGroup.current = await createProject(
                    {
                      name: '我的应用',
                      key: `apps-${crypto.randomUUID().slice(0, 8)}`,
                      framework: 'other',
                      description: '',
                    },
                    signal,
                  )
                  projectId = createdGroup.current.id
                }
                // 2. 平台与真实包身份仍须用户明确填写，不能从应用名称猜测。
                return createApplication(
                  projectId,
                  { name: values.name, platform: values.platform, identifier: values.identifier },
                  signal,
                )
              },
              (saved) => {
                draft.clear()
                setApplication(saved)
                setStep(1)
                onCreated()
              },
            )
          }
        >
          <Form.Item
            name="name"
            label="应用名称"
            rules={[{ required: true, whitespace: true, max: 60 }]}
          >
            <Input maxLength={60} />
          </Form.Item>
          <Form.Item name="platform" label="应用平台" rules={[{ required: true }]}>
            <Select
              onChange={setPlatform}
              options={[
                { value: 'android', label: 'Android' },
                { value: 'ios', label: 'iOS' },
                { value: 'harmony', label: 'HarmonyOS' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="identifier"
            label={
              platform === 'android'
                ? 'Android 包名'
                : platform === 'ios'
                  ? 'iOS Bundle ID'
                  : 'HarmonyOS Bundle Name'
            }
            extra="填写现有安装包的真实身份；创建后平台与包身份不可修改。"
            rules={[{ required: true, whitespace: true, max: 255 }]}
          >
            <Input spellCheck={false} placeholder="com.example.app" />
          </Form.Item>
          {projects.length > 0 && (
            <Form.Item
              name="projectId"
              label="项目分组（选填）"
              extra="仅用于归类；留空时会创建“我的应用”分组。"
            >
              <Select
                allowClear
                options={projects.map((project) => ({ value: project.id, label: project.name }))}
              />
            </Form.Item>
          )}
          {error && <Alert role="alert" type="error" title={error} className="form-feedback" />}
          <Button type="primary" htmlType="submit" loading={saving}>
            保存并配置渠道
          </Button>
        </Form>
      )}
      {step === 1 && application && (
        <Flex vertical gap={16}>
          <BindingsPanel application={application} inSetup />
          <Button type="primary" onClick={() => setStep(2)}>
            下一步：就绪检查
          </Button>
        </Flex>
      )}
      {step === 2 && application && (
        <ApplicationReadiness
          application={application}
          onBack={() => setStep(1)}
          onOpen={() => onOpen(application.projectId, application.id)}
        />
      )}
    </section>
  )
}
