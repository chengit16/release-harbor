/** @description 当前应用的只读预检入口，组合安全目录、对象选择和历史事实，不读取秘密或自动执行。 */
import { useState } from 'react'
import { Alert, Button, Card, Form, Select, Skeleton, Typography } from 'antd'
import type { Application } from '@release-harbor/contracts'
import { startPreflight } from '../../api/services/preflights.ts'
import { useSubmission } from '../../hooks/useSubmission.ts'
import { usePreflights } from './usePreflights.ts'
import { PreflightResults } from './PreflightResults.tsx'
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
    <section aria-label="只读预检" className="preflight-panel">
      <Card
        className="preflight-configuration"
        title={<h2>执行配置</h2>}
        extra={
          <Button onClick={refresh} loading={loading} disabled={saving}>
            刷新目录与记录
          </Button>
        }
      >
        <Alert
          type="info"
          showIcon
          title="只读核验，不执行发布"
          description="核对安装包、凭据与应用目标。结果有效五分钟，配置或文件变化后失效。"
        />
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
        {data && (
          <Form layout="vertical" onFinish={run} disabled={saving || busy}>
            <div className="preflight-selection-grid">
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
            </div>
            <div className="preflight-execution-bar">
              {binding && (
                <Typography.Paragraph>
                  商店账号：
                  <Typography.Text>
                    {accountCatalog?.accounts.find(
                      (a) => a.reference === binding.credentialReference,
                    )?.displayName ?? '原账号待核对'}
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
            </div>
          </Form>
        )}
      </Card>
      {loading && !data ? (
        <Skeleton active paragraph={{ rows: 4 }} />
      ) : (
        data && (
          <PreflightResults
            views={data.views}
            context={{ accounts: accountCatalog?.accounts ?? [], artifacts: data.artifacts }}
          />
        )
      )}
    </section>
  )
}
