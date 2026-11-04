/** @description 小米向导局部材料表单；密码、测试登录材料与公钥仅在 Form 内存中临时持有。 */
import { useEffect } from 'react'
import { Form, Input, Select, Typography } from 'antd'
import type { FormInstance } from 'antd'

/** 同一向导的局部 Form；只构造受限测试材料，不向父页面传播秘密。 */
export interface XiaomiCredentialFieldsProps {
  /** 生命周期和退出清理由所属向导负责。 */
  form: FormInstance
}
/** 平台“私钥”实际是 API 访问密码；以普通表单生成官方测试结构，用户无需编写 JSON。
 * 长函数保留原因：同一 Form 管理此渠道的临时材料；测试结构在局部派生，不向父页面传播秘密。
 */
export function XiaomiCredentialFields({ form }: XiaomiCredentialFieldsProps) {
  // 1. 只订阅本次向导字段，关闭后由向导统一清理。
  const mode = Form.useWatch('xiaomiTestMode', form)
  const notes = Form.useWatch('xiaomiAuditNotes', form)
  const account = Form.useWatch('xiaomiTestUsername', form)
  const password = Form.useWatch('xiaomiTestPassword', form)
  const code = Form.useWatch('xiaomiTestCode', form)
  // 2. 只生成官方允许的结构，未选方式或缺少材料时不形成可保存内容。
  useEffect(() => {
    const ready =
      (mode === 'no_login' || ((mode === 'password' || mode === 'sms') && account && password)) &&
      notes?.trim()
    form.setFieldValue(
      'testAccountJson',
      ready
        ? JSON.stringify({
            zh_CN: {
              auditNotes: notes,
              ...(mode === 'no_login'
                ? {}
                : {
                    accounts: [
                      {
                        t: mode === 'password' ? 1 : 2,
                        a: account,
                        p: password,
                        ...(code ? { c: code } : {}),
                      },
                    ],
                  }),
            },
          })
        : undefined,
    )
  }, [mode, notes, account, password, code, form])
  // 3. 用户填写常规字段，结构化 JSON 只作为局部隐藏材料参与安全提交。
  return (
    <>
      <Typography.Paragraph>
        从小米开发者平台“管理中心 → 自动发布接口”获取开发者邮箱、API 访问密码和公钥。
        <Typography.Link
          href="https://dev.mi.com/xiaomihyperos/documentation/detail?pId=1134"
          target="_blank"
          rel="noreferrer"
        >
          查看官方说明 ↗
        </Typography.Link>
      </Typography.Paragraph>
      <Form.Item
        name="userName"
        label="开发者邮箱"
        rules={[{ required: true, type: 'email', message: '请输入开发者平台登录邮箱' }]}
      >
        <Input autoComplete="off" spellCheck={false} />
      </Form.Item>
      <Form.Item
        name="privateKey"
        label="API 访问密码"
        extra="平台称为“私钥”，不是小米账号登录密码，也不是 Apple .p8。重置后需重新录入。"
        rules={[{ required: true, whitespace: true, max: 4096 }]}
      >
        <Input.Password autoComplete="new-password" spellCheck={false} />
      </Form.Item>
      <Form.Item
        name="publicKey"
        label="RSA 公钥内容"
        extra="用文本编辑器打开平台下载的公钥／证书，粘贴完整内容。"
        rules={[{ required: true, whitespace: true, max: 65536 }]}
      >
        <Input.TextArea autoComplete="off" rows={5} spellCheck={false} />
      </Form.Item>
      <Typography.Paragraph>
        以下为商店审核人员的测试材料，仅保存在本机安全存储。不同应用登录材料不同时，请分别建立档案。
      </Typography.Paragraph>
      <Form.Item
        name="xiaomiTestMode"
        label="审核测试方式"
        rules={[{ required: true, message: '请选择测试方式' }]}
      >
        <Select
          aria-label="审核测试方式"
          options={[
            { value: 'no_login', label: '无需登录' },
            { value: 'password', label: '测试账号密码登录' },
            { value: 'sms', label: '固定测试短信验证码' },
          ]}
          placeholder="选择审核人员如何体验应用"
        />
      </Form.Item>
      {(mode === 'password' || mode === 'sms') && (
        <>
          <Form.Item
            name="xiaomiTestUsername"
            label={mode === 'sms' ? '测试手机号' : '审核测试账号'}
            rules={[{ required: true, whitespace: true, max: 50 }]}
          >
            <Input autoComplete="off" spellCheck={false} />
          </Form.Item>
          <Form.Item
            name="xiaomiTestPassword"
            label={mode === 'sms' ? '固定测试验证码' : '审核测试密码'}
            rules={[{ required: true, whitespace: true, max: 50 }]}
          >
            <Input.Password autoComplete="new-password" spellCheck={false} />
          </Form.Item>
          <Form.Item name="xiaomiTestCode" label="注册／准入码（选填）" rules={[{ max: 50 }]}>
            <Input.Password autoComplete="new-password" spellCheck={false} />
          </Form.Item>
        </>
      )}
      <Form.Item
        name="xiaomiAuditNotes"
        label="审核体验说明"
        extra="说明功能入口、测试步骤和登录限制；需要登录的应用应选择测试账号方式。"
        rules={[{ required: true, whitespace: true, max: 500 }]}
      >
        <Input.TextArea autoComplete="off" rows={3} maxLength={500} />
      </Form.Item>
      <Form.Item name="testAccountJson" hidden>
        <Input type="hidden" />
      </Form.Item>
    </>
  )
}
