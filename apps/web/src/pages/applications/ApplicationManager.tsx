/** @description 项目应用列表与完整宽度工作台互斥，URL 维护选择及页签，不加载或解析凭据。 */
import { useRef, useState, type ComponentRef } from 'react'
import { Alert, Button, Card, Empty, Select, Space, Tabs, Tag, Typography } from 'antd'
import type { Application } from '@release-harbor/contracts'
import { ApplicationForm } from './ApplicationForm.tsx'
import { BindingsPanel } from './BindingsPanel.tsx'
import { useApplications } from './useApplicationData.ts'
import { ArtifactsPanel } from '../artifacts/ArtifactsPanel.tsx'
import { PreflightsPanel } from '../preflights/PreflightsPanel.tsx'
import { ReleasePlansPanel } from '../releasePlans/ReleasePlansPanel.tsx'
import type { ApplicationTab } from '../projects/useSelection.ts'

/** 项目内应用定位及导航，页面切换必须卸载旧业务面板。 */
export interface ApplicationManagerProps {
  /** 当前公开项目 ID。 */
  projectId: string
  /** 为空展示应用列表，未知 ID 明确报错。 */
  applicationId: string
  /** 当前 URL 中受限的页签。 */
  tab: ApplicationTab
  /** 切换应用默认回到绑定页，空字符串返回应用列表。 */
  onSelect: (applicationId: string) => void
  /** 只有点击页签才更新定位，不执行预检。 */
  onTabChange: (tab: ApplicationTab) => void
}

function ApplicationIdentity({ application }: { application: Application }) {
  return (
    <div className="application-identity">
      <div className="application-title-row">
        <h1>{application.name}</h1>
        <Tag>{application.platform === 'android' ? 'Android' : 'iOS'}</Tag>
      </div>
      <Typography.Text type="secondary" className="application-identifier">
        {application.platform === 'android' ? 'Android 包名' : 'iOS Bundle ID'}：
        {application.identifier}
      </Typography.Text>
    </div>
  )
}

/**
 * 应用切换与新建集中在顶部，业务面板使用整行空间。
 * 长函数保留原因：集中表达列表、创建和详情的互斥关系，网络与业务表单已拆分。
 */
export function ApplicationManager({
  projectId,
  applicationId,
  tab,
  onSelect,
  onTabChange,
}: ApplicationManagerProps) {
  // 1. 项目 key 隔离列表生命周期，应用 key 隔离草稿、预检选择和轮询。
  const { items, loading, error, refresh } = useApplications(projectId)
  const [showForm, setShowForm] = useState(false)
  const [notice, setNotice] = useState('')
  const trigger = useRef<ComponentRef<typeof Button>>(null)
  const selected = items.find((item) => item.id === applicationId)
  function close(): void {
    setShowForm(false)
    trigger.current?.focus()
  }
  function switchApplication(id: string): void {
    setShowForm(false)
    setNotice('')
    onSelect(id)
  }
  // 2. 全部操作保留在顶部；切换前清理本页公开反馈，不把另一个应用的状态带入。
  return (
    <section className="application-manager" aria-label="项目应用">
      <div className="section-title application-heading">
        {selected ? (
          <ApplicationIdentity application={selected} />
        ) : applicationId ? (
          <h2>应用工作台</h2>
        ) : (
          <h2>
            平台应用 <Tag>{items.length}</Tag>
          </h2>
        )}
        <Space wrap className="application-toolbar">
          {applicationId && <Button onClick={() => switchApplication('')}>返回应用列表</Button>}
          {applicationId && (
            <Select
              aria-label="切换应用"
              value={selected?.id}
              loading={loading}
              placeholder="切换应用"
              showSearch
              optionFilterProp="label"
              className="application-switcher"
              onChange={switchApplication}
              options={items.map((item) => ({
                value: item.id,
                label: `${item.name} · ${item.platform === 'android' ? 'Android' : 'iOS'}`,
              }))}
            />
          )}
          <Button
            ref={trigger}
            type={applicationId ? 'default' : 'primary'}
            onClick={() => {
              setShowForm(true)
              setNotice('')
            }}
          >
            新建应用
          </Button>
        </Space>
      </div>
      {notice && (
        <Alert className="form-feedback" role="status" type="success" showIcon title={notice} />
      )}
      {showForm && (
        <ApplicationForm
          projectId={projectId}
          onCancel={close}
          onSaved={(application) => {
            close()
            refresh()
            onSelect(application.id)
            setNotice('应用已保存到本机工作空间')
          }}
        />
      )}
      {loading && (
        <p role="status" className="binding-explanation">
          正在读取应用…
        </p>
      )}
      {error && (
        <Alert
          className="form-feedback"
          role="alert"
          type="error"
          showIcon
          title={error}
          action={<Button onClick={refresh}>重新读取应用</Button>}
        />
      )}
      {!loading && !error && !applicationId && items.length === 0 && (
        <Empty description="为 Android 和 iOS 分别登记真实包身份，再关联各自的商店目标。" />
      )}
      {!applicationId && (
        <div className="application-list" aria-label="应用列表">
          {items.map((item) => (
            <Card
              key={item.id}
              title={<h3>{item.name}</h3>}
              extra={<Tag>{item.platform === 'android' ? 'Android' : 'iOS'}</Tag>}
            >
              <Typography.Paragraph className="application-identifier" type="secondary">
                {item.identifier}
              </Typography.Paragraph>
              <Button onClick={() => switchApplication(item.id)}>进入应用工作台</Button>
            </Card>
          ))}
        </div>
      )}
      {/* 3. 选中后不渲染并列应用卡片；URL 回退会重新建立正确页签和业务边界。 */}
      {selected && (
        <section className="application-workbench" aria-label="应用详情">
          <Tabs
            key={selected.id}
            activeKey={tab}
            destroyOnHidden
            onChange={(value) => {
              if (
                value === 'bindings' ||
                value === 'artifacts' ||
                value === 'preflight' ||
                value === 'plans'
              )
                onTabChange(value)
            }}
            items={[
              {
                key: 'bindings',
                label: '商店绑定',
                children: <BindingsPanel application={selected} />,
              },
              {
                key: 'artifacts',
                label: '安装包',
                children: <ArtifactsPanel application={selected} />,
              },
              {
                key: 'preflight',
                label: '只读预检',
                children: <PreflightsPanel application={selected} />,
              },
              {
                key: 'plans',
                label: '发布计划',
                children: <ReleasePlansPanel key={selected.id} application={selected} />,
              },
            ]}
          />
        </section>
      )}
      {!loading && !error && applicationId && !selected && (
        <Alert
          role="alert"
          type="error"
          title="当前项目下找不到该应用。"
          action={<Button onClick={() => onSelect('')}>返回应用列表</Button>}
        />
      )}
    </section>
  )
}
