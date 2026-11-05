/** @description 展示当前应用的商店目标与公开账号，维护绑定编辑和刷新，不以绑定记录推断发布状态。 */
import { useEffect, useRef, useState, type ComponentRef } from 'react'
import { Alert, Button, Empty, Tag } from 'antd'
import type { Application } from '@release-harbor/contracts'
import { BindingForm } from './BindingForm.tsx'
import { BindingList } from './BindingList.tsx'
import { useBindings } from './useApplicationData.ts'
import { useCredentialAccounts } from '../accounts/useCredentialAccounts.ts'

/** 绑定面板只接收已经核对归属的应用。 */
export interface BindingsPanelProps {
  /** 页面切换应用时由父组件通过 key 卸载，清理旧请求和草稿。 */
  application: Application
}

/** 保存、编辑与刷新只维护公开配置，发布动作由独立入口明确触发。 */
export function BindingsPanel({ application }: BindingsPanelProps) {
  const { items, loading, error, refresh } = useBindings(application.projectId, application.id)
  const { catalog, loading: accountsLoading, refresh: refreshAccounts } = useCredentialAccounts()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const trigger = useRef<ComponentRef<typeof Button>>(null)
  const opened = useRef(false)
  // 编辑时列表会卸载；回到列表后把焦点还给原渠道入口，不在首次进入页面时抢焦点。
  useEffect(() => {
    if (editingId === null && opened.current) trigger.current?.focus()
  }, [editingId])
  const binding = items.find((item) => item.id === editingId) ?? null
  function open(id: string): void {
    opened.current = true
    setFocusId(id === 'new' ? null : id)
    setNotice('')
    setEditingId(id)
  }
  function close(): void {
    setEditingId(null)
  }
  return (
    <section className="bindings-panel" aria-label="商店绑定">
      <div className="binding-toolbar">
        <div className="binding-heading">
          <h3>商店目标</h3>
          <Tag>{error ? '读取失败' : loading ? '正在读取' : `已绑定 ${items.length} 个渠道`}</Tag>
        </div>
        {editingId === null && (
          <Button
            type="primary"
            ref={focusId === null ? trigger : undefined}
            disabled={loading || !!error}
            onClick={() => open('new')}
          >
            添加商店绑定
          </Button>
        )}
      </div>
      <p className="binding-explanation">
        管理各商店的应用目标与发布账号。目标按渠道区分包名和 App ID，保存后可用于准备发布。
      </p>
      {loading && (
        <p role="status" className="binding-explanation">
          正在读取商店配置…
        </p>
      )}
      {error && (
        <Alert
          className="form-feedback"
          role="alert"
          type="error"
          showIcon
          title={error}
          action={<Button onClick={refresh}>重新读取配置</Button>}
        />
      )}
      {notice && (
        <Alert className="form-feedback" role="status" type="success" showIcon title={notice} />
      )}
      {editingId !== null ? (
        <BindingForm
          application={application}
          binding={binding}
          onRefresh={refresh}
          onCancel={close}
          onSaved={() => {
            close()
            refresh()
            refreshAccounts()
            setNotice('商店绑定已保存，可在发布计划中准备发布。')
          }}
        />
      ) : items.length > 0 ? (
        <BindingList
          items={items}
          accounts={catalog?.code === 'available' ? catalog.accounts : undefined}
          accountsLoading={accountsLoading}
          onEdit={open}
          focusId={focusId}
          focusRef={trigger}
        />
      ) : !loading && !error ? (
        <Empty
          className="binding-empty"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="尚未配置商店目标"
        >
          <span className="caption">点击“添加商店绑定”，选择渠道、目标及对应账号。</span>
        </Empty>
      ) : null}
      <p className="capability-note">
        保存绑定不会上传、送审或上线。每次准备发布时会重新核对安装包、账号和商店目标，结果请在发布记录中查看。
      </p>
    </section>
  )
}
