/** @description 小米公开资料输入；PNG 在浏览器计算摘要，服务端与执行器仍须重算，绝不接收本机路径。 */
import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Form, Input, Upload } from 'antd'
import type { FormInstance } from 'antd'

/** 仅操作同一发布表单内的非秘密资料。 */
export interface XiaomiUpdateFieldsProps {
  /** 所属表单管理提交与错误恢复，上传文件只在内存读取。 */
  form: FormInstance
}
/** 异步文件读取按版本丢弃过时结果，切换渠道及卸载不遗留异步更新。 */
export function XiaomiUpdateFields({ form }: XiaomiUpdateFieldsProps) {
  const [error, setError] = useState('')
  const reading = useRef(0)
  const icon = Form.useWatch(['xiaomi', 'iconBase64'], form)
  useEffect(
    () => () => {
      reading.current++
    },
    [],
  )
  return (
    <>
      <Alert
        type="warning"
        showIcon
        title="小米：更新并提交审核"
        description="仅支持已有应用单 APK 更新。确认后将提交审核，可能进入平台后续发布流程，不会仅保存草稿。测试材料使用当前小米账号档案中的内容，不同应用材料不同时请分别建档。"
        className="form-feedback"
      />
      <Form.Item
        name={['xiaomi', 'appName']}
        label="小米后台应用名称"
        extra="填写当前小米后台名称；执行前会比对，不以工作台别名覆盖商店名称。"
        rules={[{ required: true, whitespace: true, max: 60 }]}
      >
        <Input aria-label="小米后台应用名称" maxLength={60} />
      </Form.Item>
      <Form.Item
        name={['xiaomi', 'privacyUrl']}
        label="隐私政策地址"
        rules={[
          { required: true, message: '请填写 HTTPS 隐私政策地址' },
          {
            validator: (_, value) => {
              try {
                const u = new URL(value)
                if (u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash)
                  return Promise.resolve()
              } catch {
                /* 字段内固定提示 */
              }
              return Promise.reject(new Error('需为不含账号、查询参数或片段的 HTTPS 地址'))
            },
          },
        ]}
      >
        <Input
          aria-label="隐私政策地址"
          maxLength={2048}
          placeholder="https://example.com/privacy"
        />
      </Form.Item>
      <Form.Item
        label="小米提交图标（PNG）"
        required
        extra="不超过 256 KiB、边长不超过 2048px；图标会随本次摘要固定。"
      >
        <Upload
          accept="image/png,.png"
          showUploadList={false}
          maxCount={1}
          beforeUpload={async (file) => {
            const revision = ++reading.current
            setError('')
            form.setFieldValue(['xiaomi', 'iconBase64'], undefined)
            form.setFieldValue(['xiaomi', 'iconSha256'], undefined)
            if (!file.size || file.size > 256 * 1024 || !file.name.toLowerCase().endsWith('.png')) {
              setError('请选择不超过 256 KiB 的 PNG')
              return Upload.LIST_IGNORE
            }
            try {
              const buffer = await file.arrayBuffer()
              const bytes = new Uint8Array(buffer)
              const hash = await crypto.subtle.digest('SHA-256', buffer)
              let raw = ''
              for (const byte of bytes) raw += String.fromCharCode(byte)
              if (revision === reading.current) {
                form.setFieldValue(['xiaomi', 'iconBase64'], btoa(raw))
                form.setFieldValue(
                  ['xiaomi', 'iconSha256'],
                  Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join(''),
                )
              }
            } catch {
              if (revision === reading.current) setError('图标读取失败，请重新选择')
            }
            return false
          }}
        >
          <Button>选择 PNG 图标</Button>
        </Upload>
        {typeof icon === 'string' && (
          <img
            src={'data:image/png;base64,' + icon}
            alt="已选小米图标"
            width={64}
            height={64}
            style={{ marginTop: 12, display: 'block' }}
          />
        )}
      </Form.Item>
      <Form.Item
        name={['xiaomi', 'iconBase64']}
        hidden
        rules={[{ required: true, message: '请选择 PNG 图标' }]}
      >
        <Input type="hidden" />
      </Form.Item>
      <Form.Item name={['xiaomi', 'iconSha256']} hidden rules={[{ required: true }]}>
        <Input type="hidden" />
      </Form.Item>
      {error && <Alert role="alert" type="error" showIcon title={error} />}
    </>
  )
}
