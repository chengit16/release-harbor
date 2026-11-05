/** @description 页面内账号录入 Drawer，材料仅在当前 Form 内存保留，经专用通道直接交给本机配置进程。 */
import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Form,
  Input,
  Select,
  Space,
  Steps,
  Typography,
} from 'antd'
import {
  channelLabels,
  type BindingChannel,
  type CredentialAccount,
} from '@release-harbor/contracts'
import { CredentialMaterialFields } from './CredentialMaterialFields.tsx'
import { useCredentialSetup } from './useCredentialSetup.ts'
import { useCompactLayout } from '../../app/useCompactLayout.ts'

/** 只回报公开引用，材料不通过父组件回调传播。 */
export interface CredentialWizardProps {
  /** 从绑定打开时锁定渠道，账号管理入口可自行选择。 */
  channel?: BindingChannel
  /** 重新录入保留原账号引用，仅预填公开信息，绝不回显已保存材料。 */
  account?: CredentialAccount
  /** 关闭时父组件卸载整个向导，保留公开绑定草稿。 */
  onClose: () => void
  /** 服务确认保存后触发，不代表商店鉴权通过。 */
  onSaved: (reference: string) => void
}

const materialFields = [
  'accessKey',
  'accessSecret',
  'clientId',
  'clientSecret',
  'apiIssuerId',
  'apiKeyId',
  'privateKey',
  'userName',
  'publicKey',
  'testAccountJson',
  'xiaomiTestMode',
  'xiaomiAuditNotes',
  'xiaomiTestUsername',
  'xiaomiTestPassword',
  'xiaomiTestCode',
]

/**
 * 三个步骤复用同一个局部 Form；退出时清理秘密，保存未知后只能查询原操作。
 * 长函数保留原因：同一 Form 控制三步临时材料，网络和文件读取已拆出，避免秘密流入父页面状态。
 */
export function CredentialWizard({
  channel: locked,
  account,
  onClose,
  onSaved,
}: CredentialWizardProps) {
  // 1. 材料只留在此 Form；保存和卸载都清理，不沿用另一向导的数据。
  const compact = useCompactLayout()
  const [form] = Form.useForm()
  const [channel, setChannel] = useState<BindingChannel>(account?.channel ?? locked ?? 'huawei')
  const [step, setStep] = useState(0)
  const [validationError, setValidationError] = useState('')
  const clearMaterials = (): void => {
    form.setFieldsValue(Object.fromEntries(materialFields.map((key) => [key, undefined])))
  }
  const setup = useCredentialSetup(
    channel,
    (reference) => {
      clearMaterials()
      onSaved(reference)
    },
    clearMaterials,
    account
      ? { reference: account.reference, expectedRevision: account.managementRevision }
      : undefined,
  )
  useEffect(
    () => () => {
      form.resetFields()
    },
    [form],
  )
  async function next(): Promise<void> {
    setValidationError('')
    try {
      if (step === 0) {
        await form.validateFields(['displayName'])
        if (await setup.prepare()) setStep(1)
      } else {
        if (channel === 'app_store' && !form.getFieldValue('privateKey')) {
          setValidationError('请选择 Apple .p8 私钥文件后继续')
          return
        }
        await form.validateFields(
          channel === 'huawei' || channel === 'oppo' || channel === 'meizu' || channel === 'honor'
            ? ['clientId', 'clientSecret']
            : channel === 'vivo'
              ? ['accessKey', 'accessSecret']
              : channel === 'xiaomi'
                ? [
                    'userName',
                    'privateKey',
                    'publicKey',
                    'xiaomiTestMode',
                    'xiaomiAuditNotes',
                    'xiaomiTestUsername',
                    'xiaomiTestPassword',
                    'xiaomiTestCode',
                  ]
                : ['apiIssuerId', 'apiKeyId', 'privateKey'],
        )
        setStep(2)
      }
    } catch {
      /* Form 在字段旁显示校验，不把输入值附加到错误日志。 */
    }
  }
  function save(): void {
    // 2. 明确点击才构造当前渠道材料，提交与查询由局部会话 Hook 编排。
    const keys =
      channel === 'huawei' || channel === 'oppo' || channel === 'meizu' || channel === 'honor'
        ? ['clientId', 'clientSecret']
        : channel === 'vivo'
          ? ['accessKey', 'accessSecret']
          : channel === 'xiaomi'
            ? ['userName', 'privateKey', 'publicKey', 'testAccountJson']
            : ['apiIssuerId', 'apiKeyId', 'privateKey']
    const credentials = Object.fromEntries(
      keys.map((key) => [key, String(form.getFieldValue(key) ?? '')]),
    )
    void setup.save({ displayName: String(form.getFieldValue('displayName') ?? ''), credentials })
  }
  // 3. 受理保存后冻结步骤，仅保留查询和关闭，避免超时引发重复保存。
  return (
    <Drawer
      open
      title={account ? '重新录入凭据' : '新增商店账号'}
      size={compact ? '100%' : 560}
      destroyOnHidden
      onClose={onClose}
      className="credential-wizard"
      footer={
        <Space wrap style={{ width: '100%', justifyContent: 'flex-end' }}>
          <Button onClick={onClose}>{setup.attempted ? '关闭并稍后核对' : '取消'}</Button>
          {!setup.attempted && step > 0 && (
            <Button disabled={setup.working} onClick={() => setStep((value) => value - 1)}>
              上一步
            </Button>
          )}
          {!setup.attempted &&
            (step < 2 ? (
              <Button type="primary" loading={setup.working} onClick={() => void next()}>
                下一步
              </Button>
            ) : (
              <Button type="primary" loading={setup.working} onClick={save}>
                保存账号
              </Button>
            ))}
          {setup.attempted && (
            <Button loading={setup.working} onClick={() => void setup.query()}>
              查询本次保存结果
            </Button>
          )}
        </Space>
      }
    >
      <Steps
        size="small"
        current={step}
        items={[{ title: '账号信息' }, { title: '配置材料' }, { title: '确认保存' }]}
      />
      <Alert
        style={{ marginBlock: 24 }}
        type="info"
        showIcon
        title="保存在本机安全存储"
        description="页面只在录入期间临时处理凭据，关闭后清理输入。账号保存后，仍需针对应用运行只读预检。"
      />
      {setup.error && (
        <Alert
          style={{ marginBottom: 16 }}
          role="alert"
          type="error"
          showIcon
          title={setup.error}
        />
      )}
      {validationError && (
        <Alert
          role="alert"
          type="error"
          style={{ marginBottom: 16 }}
          title={validationError}
          showIcon
        />
      )}
      {setup.attempted && (
        <Alert
          style={{ marginBottom: 16 }}
          type="warning"
          showIcon
          title={setup.working ? '正在保存并核对结果' : '请核对本次保存结果'}
          description="如 macOS 显示钥匙串提示，请在系统窗口完成操作。关闭页面不会撤销已开始的保存；可在商店账号中重新读取结果。"
        />
      )}
      <Form
        form={form}
        layout="vertical"
        name="credential-setup"
        initialValues={{ displayName: account?.displayName }}
        preserve={false}
        disabled={setup.working || setup.attempted}
        autoComplete="off"
      >
        <div hidden={step !== 0 || setup.attempted}>
          <Form.Item label="商店渠道">
            <Select
              aria-label="商店渠道"
              value={channel}
              disabled={Boolean(locked || account) || setup.working}
              options={[
                { label: '华为 AppGallery', value: 'huawei' },
                { label: 'Apple App Store', value: 'app_store' },
                { label: '小米', value: 'xiaomi' },
                { label: 'OPPO', value: 'oppo' },
                { label: 'vivo', value: 'vivo' },
                { label: '魅族', value: 'meizu' },
                { label: '荣耀', value: 'honor' },
              ]}
              onChange={(value: BindingChannel) => {
                clearMaterials()
                setChannel(value)
              }}
            />
          </Form.Item>
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
            extra="仅用于在工作台识别账号，不会修改商店账号或应用信息。"
          >
            <Input maxLength={60} placeholder="给账号起一个易识别的名称" />
          </Form.Item>
        </div>
        <div hidden={step !== 1 || setup.attempted}>
          <CredentialMaterialFields key={channel} channel={channel} form={form} />
        </div>
        {step === 2 && !setup.attempted && (
          <>
            <Descriptions
              column={1}
              bordered
              size="small"
              items={[
                { key: 'name', label: '账号名称', children: form.getFieldValue('displayName') },
                {
                  key: 'channel',
                  label: '渠道',
                  children: channelLabels[channel],
                },
                { key: 'material', label: '凭据材料', children: '已填写，仅用于本次安全保存' },
                { key: 'storage', label: '存储方式', children: 'macOS Keychain / 加密文件' },
              ]}
            />
            <Typography.Paragraph className="binding-explanation" style={{ marginTop: 16 }}>
              {account
                ? '保存将替换此账号的本机凭据并使已有预检失效，原有应用绑定保留。'
                : '保存不会查询商店、上传安装包或提交审核。'}
            </Typography.Paragraph>
          </>
        )}
      </Form>
    </Drawer>
  )
}
