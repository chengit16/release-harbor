/** @description 项目内应用列表和详情，数据来自公开 API；URL 只维护定位，不提供授权。 */
import { useRef, useState, type ComponentRef } from 'react'
import { Alert, Button, Empty, Tabs } from 'antd'
import { ApplicationForm } from './ApplicationForm.tsx'
import { BindingsPanel } from './BindingsPanel.tsx'
import { useApplications } from './useApplicationData.ts'
import { ArtifactsPanel } from '../artifacts/ArtifactsPanel.tsx'
import { PreflightsPanel } from '../preflights/PreflightsPanel.tsx'

/** 项目内应用选择与导航。 */
export interface ApplicationManagerProps {
  /** 由当前选中的公开项目确定。 */
  projectId: string
  /** URL 中的应用定位，找不到时展示明确错误。 */
  applicationId: string
  /** 切换应用时同步 URL，空字符串返回应用列表。 */
  onSelect: (applicationId: string) => void
}

/**
 * 创建应用、展示身份并组合绑定与安装包管理，不解析凭据。
 * 长函数保留原因：集中表达列表、选择及详情的相邻布局，网络和编辑行为已分离。
 */
export function ApplicationManager({
  projectId,
  applicationId,
  onSelect,
}: ApplicationManagerProps) {
  const { items, loading, error, refresh } = useApplications(projectId)
  const [showForm, setShowForm] = useState(false)
  const [notice, setNotice] = useState('')
  const trigger = useRef<ComponentRef<typeof Button>>(null)
  const selected = items.find((item) => item.id === applicationId)
  function close(): void {
    setShowForm(false)
    trigger.current?.focus()
  }
  return (
    <section className="application-manager" aria-label="项目应用">
      <div className="section-title application-heading">
        <div>
          <p className="eyebrow">APPLICATIONS</p>
          <h2>平台应用</h2>
        </div>
        <Button
          ref={trigger}
          type="primary"
          onClick={() => {
            setShowForm(true)
            setNotice('')
          }}
        >
          新建应用
        </Button>
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
      {!loading && !error && items.length === 0 && (
        <Empty description="为 Android 和 iOS 分别登记真实包身份，再关联各自的商店目标。" />
      )}
      <div className="application-layout">
        <div className="application-list" aria-label="应用列表">
          {items.map((item) => (
            <button
              key={item.id}
              className={'application-card' + (item.id === applicationId ? ' selected' : '')}
              aria-pressed={item.id === applicationId}
              onClick={() => {
                setShowForm(false)
                setNotice('')
                onSelect(item.id)
              }}
            >
              <span className="platform-label">
                {item.platform === 'android' ? 'ANDROID' : 'iOS'}
              </span>
              <strong>{item.name}</strong>
              <code>{item.identifier}</code>
              <span className="caption">查看身份与商店绑定 ↗</span>
            </button>
          ))}
        </div>
        {selected && (
          <section className="application-detail" aria-label="应用详情">
            <p className="eyebrow">APPLICATION IDENTITY</p>
            <h3>{selected.name}</h3>
            <dl className="identity-grid">
              <div>
                <dt>平台</dt>
                <dd>{selected.platform === 'android' ? 'Android' : 'iOS'}</dd>
              </div>
              <div>
                <dt>{selected.platform === 'android' ? 'Android 包名' : 'iOS Bundle ID'}</dt>
                <dd>
                  <code>{selected.identifier}</code>
                </dd>
              </div>
            </dl>
            <Tabs
              key={selected.id}
              destroyOnHidden
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
              ]}
            />
          </section>
        )}
        {!loading && !error && applicationId && !selected && (
          <p role="alert" className="form-error">
            当前项目下找不到该应用。
            <Button type="link" onClick={() => onSelect('')}>
              返回应用列表
            </Button>
          </p>
        )}
      </div>
    </section>
  )
}
