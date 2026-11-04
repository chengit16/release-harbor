/** @description 展示真实持久化的商店配置与未预检状态，独立管理绑定编辑和刷新。 */
import { isPackageTargetChannel } from '@release-harbor/contracts'

import { useEffect, useRef, useState, type ComponentRef } from 'react'
import { Alert, Button, Tag } from 'antd'
import { channelLabels, type Application } from '@release-harbor/contracts'
import { BindingForm } from './BindingForm.tsx'
import { useBindings } from './useApplicationData.ts'
import { useCredentialAccounts } from '../accounts/useCredentialAccounts.ts'

/** 绑定面板只接收已经核对归属的应用。 */
export interface BindingsPanelProps {
  /** 页面切换应用时由父组件通过 key 卸载，清理旧请求和草稿。 */
  application: Application
}

/** 保存、编辑与刷新只维护公开配置，执行入口保持关闭。 */
export function BindingsPanel({ application }: BindingsPanelProps) {
  const { items, loading, error, refresh } = useBindings(application.projectId, application.id)
  const { catalog, refresh: refreshAccounts } = useCredentialAccounts()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const trigger = useRef<ComponentRef<typeof Button>>(null)
  // 编辑期间入口未挂载，关闭后等待新入口提交到 DOM 再恢复焦点。
  useEffect(() => {
    if (editingId === null) trigger.current?.focus()
  }, [editingId])
  const binding = items.find((item) => item.id === editingId) ?? null
  function close(): void {
    setEditingId(null)
  }
  return (
    <section className="bindings-panel" aria-label="商店绑定">
      <div className="section-title">
        <h3>商店目标</h3>
        <span className="caption">支持华为、小米与 Apple 配置</span>
      </div>
      <p className="binding-explanation">
        包身份用于核对安装包，appId 用于定位商店应用。华为／Apple
        目标独立保存；小米接口直接使用包名定位。
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
            setNotice('商店绑定已保存，凭据仍未预检。')
          }}
        />
      ) : (
        <>
          {items.length > 0 && <Button onClick={() => setEditingId('new')}>添加商店绑定</Button>}
          {items.map((item) => (
            <article className="binding-card" key={item.id}>
              <div className="section-title">
                <h4>{channelLabels[item.channel]}</h4>
                <Tag color="gold">未预检</Tag>
              </div>
              <dl className="identity-grid">
                <div>
                  <dt>{isPackageTargetChannel(item.channel) ? '目标包名' : '商店 appId'}</dt>
                  <dd>{item.appId}</dd>
                </div>
                <div>
                  <dt>商店账号</dt>
                  <dd>
                    {catalog?.accounts.find(
                      (account) =>
                        account.channel === item.channel &&
                        account.reference === item.credentialReference,
                    )?.displayName ?? '原账号待核对'}
                  </dd>
                </div>
                <div>
                  <dt>配置版本</dt>
                  <dd>{item.revision}</dd>
                </div>
              </dl>
              <Button
                ref={trigger}
                onClick={() => {
                  setNotice('')
                  setEditingId(item.id)
                }}
              >
                编辑绑定
              </Button>
            </article>
          ))}
          {!loading && !error && items.length === 0 && (
            <div className="application-empty">
              <p>尚未配置商店目标</p>
              <span>先填写商店 appId 和公开凭据引用，后续再进行只读预检。</span>
              <Button
                ref={trigger}
                onClick={() => {
                  setNotice('')
                  setEditingId('new')
                }}
              >
                添加商店绑定
              </Button>
            </div>
          )}
        </>
      )}
      <p className="capability-note">
        在“安装包”接入产物后，可到“发布计划”准备发布。华为保存草稿，小米提交审核；绑定保存本身不执行商店操作。
      </p>
    </section>
  )
}
