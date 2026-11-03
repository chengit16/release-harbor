/** @description 账号本机维护操作，确认删除、名称编辑及材料替换均显式触发；只读取安全元数据。 */
import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Form, Input, Modal, Space, Typography } from 'antd'
import type { CredentialAccount, CredentialAccountAction } from '@release-harbor/contracts'
import { manageCredentialAccount } from '../../api/services/credentialAccounts.ts'
import { CredentialWizard } from './CredentialWizard.tsx'

/** 每张卡片的操作相互隔离，服务端仍统一保护并发和绑定引用。 */
interface AccountActionsProps {
  /** 当前安全快照，所有写操作携带预期版本。 */
  account: CredentialAccount
  /** 真实服务回报后刷新目录，失败或超时也刷新以避免旧状态诱发重复提交。 */
  onChanged: (notice?: { text: string; warning: boolean }) => void
}

/**
 * 操作不自动重试；编辑错误保留输入，重新录入使用独立的材料通道。
 * 长函数保留原因：两个确认弹窗共享单次操作状态，敏感录入已独立为向导。
 */
export function AccountActions({ account, onChanged }: AccountActionsProps) {
  const [dialog, setDialog] = useState<'edit' | 'delete' | 'replace' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [form] = Form.useForm<{ displayName: string }>()
  const controller = useRef(new AbortController())
  const running = useRef(false)
  useEffect(() => {
    const current = new AbortController()
    controller.current = current
    return () => current.abort()
  }, [])

  async function act(action: CredentialAccountAction['action']): Promise<void> {
    if (running.current) return
    let displayName = ''
    if (action === 'rename') {
      try {
        displayName = (await form.validateFields()).displayName
      } catch {
        return
      }
    }
    running.current = true
    setBusy(true)
    setError('')
    try {
      // 1. 版本来自当前卡片；失败不自动用新版本重试，删除保护由服务端再次执行。
      const target = { reference: account.reference, expectedRevision: account.managementRevision }
      const result = await manageCredentialAccount(
        action === 'rename' ? { ...target, action, displayName } : { ...target, action },
        controller.current.signal,
      )
      if (controller.current.signal.aborted) return
      setDialog(null)
      const messages = {
        checked: '本机材料核对通过。商店鉴权及应用目标仍需运行只读预检。',
        needs_input:
          '未能核对完整材料。请确认钥匙串访问授权；材料缺失或无效时，点击“重新录入”修复此账号。',
        renamed: '账号名称已更新。',
        deleted: '账号及其本机凭据已删除。',
      }
      onChanged({ text: messages[result.code], warning: result.code === 'needs_input' })
    } catch (failure) {
      if (!controller.current.signal.aborted) {
        // 2. 网络中断不能承诺撤销；保留表单并重新读取目录供用户核对。
        setError(failure instanceof Error ? failure.message : '操作结果无法确认，请重新读取账号')
        onChanged()
      }
    } finally {
      running.current = false
      if (!controller.current.signal.aborted) setBusy(false)
    }
  }

  function open(next: 'edit' | 'delete'): void {
    setError('')
    form.setFieldsValue({ displayName: account.displayName })
    setDialog(next)
  }

  // 3. 所有常用操作可从卡片抵达；待核对账号同样可修复或删除，不要求返回终端。
  return (
    <>
      <Space wrap style={{ marginTop: 16 }}>
        <Button
          loading={busy && dialog === null}
          disabled={busy}
          onClick={() => void act('recheck')}
        >
          重新核对
        </Button>
        <Button disabled={busy} onClick={() => open('edit')}>
          编辑
        </Button>
        <Button disabled={busy} onClick={() => setDialog('replace')}>
          重新录入
        </Button>
        <Button danger disabled={busy} onClick={() => open('delete')}>
          删除
        </Button>
      </Space>
      {error && (
        <Alert role="alert" type="error" showIcon title={error} style={{ marginTop: 12 }} />
      )}
      <Modal
        open={dialog === 'edit'}
        title="编辑商店账号"
        destroyOnHidden
        confirmLoading={busy}
        okText="保存名称"
        cancelText="取消"
        onOk={() => void act('rename')}
        onCancel={() => !busy && setDialog(null)}
        closable={!busy}
        maskClosable={!busy}
      >
        <Form form={form} layout="vertical" disabled={busy}>
          <Form.Item
            name="displayName"
            label="账号名称"
            rules={[
              {
                required: true,
                whitespace: true,
                max: 60,
                message: '请输入 1～60 个字符的账号名称',
              },
            ]}
          >
            <Input maxLength={60} />
          </Form.Item>
        </Form>
        <Typography.Paragraph type="secondary">
          编辑名称不会修改商店登录信息。需要更新或补齐凭据时，请使用卡片上的“重新录入”。
        </Typography.Paragraph>
      </Modal>
      <Modal
        open={dialog === 'delete'}
        title="删除商店账号"
        destroyOnHidden
        confirmLoading={busy}
        okText="确认删除"
        cancelText="取消"
        okButtonProps={{ danger: true, disabled: account.applicationCount > 0 }}
        onOk={() => void act('delete')}
        onCancel={() => !busy && setDialog(null)}
        closable={!busy}
        maskClosable={!busy}
      >
        <Typography.Paragraph>
          将删除账号“{account.displayName}
          ”及其在本机保存的凭据，无法撤销。不会删除商店后台的账号或应用。
        </Typography.Paragraph>
        {account.applicationCount > 0 && (
          <Alert
            type="warning"
            showIcon
            title={`仍关联 ${account.applicationCount} 个应用，请先将商店绑定改用其他账号。`}
          />
        )}
      </Modal>
      {dialog === 'replace' && (
        <CredentialWizard
          account={account}
          channel={account.channel}
          onClose={() => {
            setDialog(null)
            onChanged()
          }}
          onSaved={() => {
            setDialog(null)
            onChanged({
              text: '凭据已重新保存，原有应用绑定保留，请重新运行只读预检。',
              warning: false,
            })
          }}
        />
      )}
    </>
  )
}
