/** @description 当前应用的只读预检入口，组合安全目录、对象选择和历史事实，秘密只由本机 CLI 管理。 */
import { useState } from 'react'
import { Alert, Button, Form, Select, Space, Tag, Typography } from 'antd'
import type { Application } from '@release-harbor/contracts'
import { startPreflight } from '../../api/services/preflights.ts'
import { useSubmission } from '../../hooks/useSubmission.ts'
import { usePreflights } from './usePreflights.ts'
import { PreflightHistory } from './PreflightHistory.tsx'
import { useCredentialAccounts } from '../accounts/useCredentialAccounts.ts'

/** 页面应用变化时卸载，不能沿用另一应用的选择。 */
export interface PreflightsPanelProps {
  /** 当前项目下已经读取的应用身份。 */
  application: Application
}

/**
 * 显式点击才访问商店，不自动预检、不填写商店秘密。
 * 长函数保留原因：相邻表单及安全提示共同表达一次只读操作，数据生命周期已交由 Hook 管理。
 */
export function PreflightsPanel({ application }: PreflightsPanelProps) {
  // 1. 只从本次读取的目录中匹配绑定引用，旧引用不能自行推导可用。
  const { data, loading, error, refresh } = usePreflights(application.projectId, application.id)
  const { catalog: accountCatalog } = useCredentialAccounts()
  const { saving, error: submitError, submit } = useSubmission()
  const [bindingId, setBindingId] = useState<string>()
  const [artifactId, setArtifactId] = useState<string>()
  const binding = data?.bindings.find((b) => b.id === bindingId)
  const artifact = data?.artifacts.find((a) => a.id === artifactId && a.status === 'ready')
  const profile = data?.catalog.profiles.find(
    (p) =>
      p.reference === binding?.credentialReference &&
      p.channel === binding?.channel &&
      p.configured,
  )
  const busy = data?.views.some((v) => v.record.status === 'running')
  // 2. 点击提交具体版本，冲突交给服务端拒绝；读取和轮询均不启动商店请求。
  function run(): void {
    if (!binding || !artifact || !profile) return
    void submit(
      (signal) =>
        startPreflight(
          application.projectId,
          application.id,
          {
            bindingId: binding.id,
            artifactId: artifact.id,
            expectedBindingRevision: binding.revision,
            expectedProfileRevision: profile.revision,
          },
          signal,
        ),
      refresh,
    )
  }
  // 3. 提示、选择和事实按同一应用展示；不提供秘密输入或发布入口。
  return (
    <section aria-label="只读预检">
      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          title="只读核验，不执行发布"
          description="点击后将复核安装包，并使用选中凭据向对应商店发起鉴权和应用查询。结果有效五分钟；配置或文件变化后失效。上传权限仍未验证。"
        />
        <Typography.Paragraph>
          可在“商店账号”管理页面或绑定表单中新增账号，保存后选择对应绑定与安装包运行预检。
          账号材料由本机配置服务安全保存，保存成功后仍需核验应用目标。
        </Typography.Paragraph>
        <Button onClick={refresh} loading={loading} disabled={saving}>
          刷新目录与记录
        </Button>
        {(error || submitError) && (
          <Alert role="alert" type="error" showIcon title={error || submitError} />
        )}
        {data?.catalog.code !== 'available' && data && (
          <Alert
            type="warning"
            showIcon
            title={
              data.catalog.code === 'unsupported_environment'
                ? '当前环境不支持 macOS 安全凭据存储'
                : '凭据目录暂不可用，请检查本机存储'
            }
          />
        )}
        {data?.catalog.code === 'available' && !data.catalog.profiles.length && (
          <Alert type="warning" showIcon title="尚未配置商店账号，请先在绑定表单或商店账号页新增" />
        )}
        {!!data?.catalog.profiles.length && (
          <Space wrap aria-label="已配置凭据档案">
            {data.catalog.profiles.map((p) => (
              <Tag key={p.reference}>
                {p.channel === 'huawei' ? '华为' : 'Apple'} ·{' '}
                {accountCatalog?.accounts.find((a) => a.reference === p.reference)?.displayName ??
                  '已有档案'}{' '}
                · {p.configured ? '已配置，待核验' : '未配置'}
              </Tag>
            ))}
          </Space>
        )}
        {data && (
          <Form layout="vertical" onFinish={run} disabled={saving || busy}>
            <Form.Item label="待核验商店绑定" required>
              <Select
                aria-label="待核验商店绑定"
                placeholder="选择已保存的商店绑定"
                value={binding?.id}
                onChange={setBindingId}
                options={data.bindings.map((b) => ({
                  value: b.id,
                  label: `${b.channel === 'huawei' ? '华为' : 'Apple'} · App ID ${b.appId}`,
                }))}
              />
            </Form.Item>
            <Form.Item label="待核验安装包" required>
              <Select
                aria-label="待核验安装包"
                placeholder="选择身份检查通过的安装包"
                value={artifact?.id}
                onChange={setArtifactId}
                options={data.artifacts
                  .filter((a) => a.status === 'ready')
                  .map((a) => ({
                    value: a.id,
                    label: `${a.fileName} · ${a.identity?.versionName}`,
                  }))}
              />
            </Form.Item>
            {binding && (
              <Typography.Paragraph>
                商店账号：
                <Typography.Text>
                  {accountCatalog?.accounts.find((a) => a.reference === binding.credentialReference)
                    ?.displayName ?? '原账号待核对'}
                </Typography.Text>{' '}
                · {profile ? '已配置，尚需核验' : '未找到同渠道的已配置档案'}
              </Typography.Paragraph>
            )}
            <Button
              type="primary"
              htmlType="submit"
              loading={saving || busy}
              disabled={!binding || !artifact || !profile || loading}
            >
              运行只读预检
            </Button>
          </Form>
        )}
        <PreflightHistory views={data?.views ?? []} />
      </Space>
    </section>
  )
}
