/** @description 向导内渠道材料输入，只持有未保存的字段与文件；不读取已保存秘密。 */
import { XiaomiCredentialFields } from './XiaomiCredentialFields.tsx'
import { useEffect, useRef, useState } from 'react'
import { Alert, Form, Input, Typography, Upload } from 'antd'
import type { FormInstance } from 'antd'
import type { BindingChannel } from '@release-harbor/contracts'

/** Form 仅来自同一向导实例，不能接入全局状态或持久化。 */
export interface CredentialMaterialFieldsProps {
  /** 本次会话锁定的渠道。 */
  channel: BindingChannel
  /** 私钥内容只写入当前 Form 内存，卸载时由父向导清理。 */
  form: FormInstance
}

/** 输入统一默认隐藏，Apple 文件手动读取为受限内容，不自动上传或提交路径。 */
export function CredentialMaterialFields({ channel, form }: CredentialMaterialFieldsProps) {
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')
  const reading = useRef(0)
  useEffect(
    () => () => {
      reading.current++
    },
    [],
  )
  if (channel === 'xiaomi') return <XiaomiCredentialFields form={form} />
  if (channel === 'huawei' || channel === 'oppo')
    return (
      <>
        <Typography.Paragraph className="binding-explanation">
          {channel === 'oppo'
            ? '在 OPPO 开放平台使用管理员账号，进入“管理中心 → 产品导航 → 我的 API → 创建服务端应用”，获取 Client ID 和 Secret。'
            : '从 AppGallery Connect 的“用户与访问 → API 密钥 → Connect API”获取同一 API 客户端的 ID 与当前 Secret。'}
          <Typography.Link
            href={
              channel === 'oppo'
                ? 'https://open.oppomobile.com/documentation/page/info?id=10998'
                : 'https://developer.huawei.com/consumer/cn/codelab/AGCPreparation-connectapi/'
            }
            target="_blank"
            rel="noreferrer"
          >
            查看获取方法 ↗
          </Typography.Link>
        </Typography.Paragraph>
        <Form.Item
          name="clientId"
          label="Client ID"
          extra="填写 API 客户端 ID，不是商店 App ID。"
          rules={[
            { required: true, whitespace: true, max: 4096 },
            ...(channel === 'oppo' ? [{ len: 19, message: 'OPPO Client ID 为 19 字符' }] : []),
          ]}
        >
          <Input.Password autoComplete="off" spellCheck={false} />
        </Form.Item>
        <Form.Item
          name="clientSecret"
          label="Client Secret"
          extra="填写上述同一 API 客户端的当前 Secret，核对是否已被重置。"
          rules={[
            { required: true, whitespace: true, max: 4096 },
            ...(channel === 'oppo' ? [{ len: 64, message: 'OPPO Client Secret 为 64 字符' }] : []),
          ]}
        >
          <Input.Password autoComplete="new-password" spellCheck={false} />
        </Form.Item>
      </>
    )
  return (
    <>
      <Typography.Paragraph className="binding-explanation">
        首轮使用 Apple 团队 API Key。
        <Typography.Link
          href="https://developer.apple.com/documentation/AppStoreConnectAPI/creating-api-keys-for-app-store-connect-api"
          target="_blank"
          rel="noreferrer"
        >
          查看获取方法 ↗
        </Typography.Link>
      </Typography.Paragraph>
      <Form.Item
        name="apiIssuerId"
        label="Issuer ID"
        rules={[
          {
            required: true,
            pattern: /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i,
            message: '请输入团队 Issuer ID（UUID）',
          },
        ]}
      >
        <Input.Password autoComplete="off" spellCheck={false} />
      </Form.Item>
      <Form.Item
        name="apiKeyId"
        label="Key ID"
        rules={[
          {
            required: true,
            pattern: /^[A-Z0-9]{10}$/,
            message: '请输入 10 位大写字母或数字 Key ID',
          },
        ]}
      >
        <Input.Password autoComplete="off" spellCheck={false} />
      </Form.Item>
      <Form.Item label="Apple .p8 私钥" required>
        <Upload.Dragger
          accept=".p8"
          maxCount={1}
          showUploadList={false}
          beforeUpload={async (file) => {
            const revision = ++reading.current
            setError('')
            setFileName('')
            form.setFieldValue('privateKey', undefined)
            if (
              !file.name.toLowerCase().endsWith('.p8') ||
              file.size > 64 * 1024 ||
              file.size === 0
            ) {
              setError('请选择不超过 64 KiB 的 .p8 私钥文件')
              return Upload.LIST_IGNORE
            }
            try {
              const content = await file.text()
              if (reading.current === revision) {
                form.setFieldValue('privateKey', content)
                setFileName(file.name)
              }
            } catch {
              if (reading.current === revision) setError('私钥文件未能读取，请重新选择')
            }
            return false
          }}
        >
          <p aria-hidden="true" style={{ fontSize: 28, color: '#64748b' }}>
            ↥
          </p>
          <p>{fileName || '点击选择或拖入 .p8 文件'}</p>
          <p className="caption">仅在本次保存时提交内容，不读取服务器路径</p>
        </Upload.Dragger>
      </Form.Item>
      <Form.Item
        name="privateKey"
        hidden
        rules={[{ required: true, message: '请选择 Apple .p8 私钥文件' }]}
      >
        <Input type="hidden" />
      </Form.Item>
      {error && <Alert type="error" role="alert" title={error} showIcon />}
    </>
  )
}
