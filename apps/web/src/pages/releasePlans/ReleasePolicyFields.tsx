/** @description Android／iOS 共用上架意图表单；时间按设备时区选择，提交时固定为 UTC，不在页面调度上传。 */
import { DatePicker, Form, Radio, Typography } from 'antd'
import type { FormInstance } from 'antd'
import type { BindingChannel } from '@release-harbor/contracts'

/** 同一发布草稿的局部字段，不读取商店秘密或自行发起网络请求。 */
export interface ReleasePolicyFieldsProps {
  /** 由当前发布表单统一提交与保留失败草稿。 */
  form: FormInstance
  /** 用于明确当前动作能否设置商店策略，不决定服务端能力。 */
  channel: BindingChannel | undefined
}
/** 指定时间是审核通过后最早可上架时间，不能将其解释为定时开始上传。 */
export function ReleasePolicyFields({ form, channel }: ReleasePolicyFieldsProps) {
  const mode = Form.useWatch('releaseMode', form)
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return (
    <>
      <Form.Item
        name="releaseMode"
        label="上架类型"
        rules={[{ required: true, message: '请选择上架类型' }]}
      >
        <Radio.Group
          options={[
            { value: 'after_approval', label: '审核通过后立即上架' },
            { value: 'scheduled', label: '指定时间上架' },
          ]}
        />
      </Form.Item>
      {mode === 'scheduled' && (
        <Form.Item
          name="releaseAt"
          label="指定上架时间"
          rules={[
            { required: true, message: '请选择未来的上架时间' },
            {
              validator: (_, value) =>
                !value || value.valueOf() > Date.now()
                  ? Promise.resolve()
                  : Promise.reject(new Error('请选择未来的上架时间')),
            },
          ]}
          extra={`时区：${zone}。审核通过且不早于此时间，实际生效时间由平台处理决定。`}
        >
          <DatePicker
            aria-label="指定上架时间"
            showTime
            // DatePicker 已先处理日期确认；阻止浏览器回车默认提交整个发布表单。
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.preventDefault()
            }}
            format="YYYY-MM-DD HH:mm:ss"
            style={{ width: '100%' }}
            disabledDate={(date) => date.endOf('day').valueOf() < Date.now()}
          />
        </Form.Item>
      )}
      <Typography.Paragraph type="secondary">
        {channel === 'vivo'
          ? '确认后上传并提交 vivo 更新，名称、图标等沿用后台资料。定时按中国标准时间（Asia/Shanghai）发送，实际审核与上架请在后台核对。'
          : channel === 'oppo'
            ? '确认后上传 APK 并提交 OPPO 版本任务，自动复用现有商店资料。定时按中国标准时间（Asia/Shanghai）发送，请在摘要核对。'
            : channel === 'xiaomi'
              ? '确认后立即上传并提交审核，上架类型交由小米处理。名称、图标和隐私政策在准备时自动复用现有上架资料。'
              : channel === 'app_store'
                ? 'iOS 使用同一上架选项；当前 Apple 执行暂缓，选择仅记录到计划，尚未设置 App Store 版本的发布方式。'
                : channel === 'huawei'
                  ? '当前华为动作仅保存草稿；上架选择记录到计划，后续送审时才可同步商店，不会因此自动送审或上线。'
                  : '上架类型表示审核通过后的发布意图。选择渠道后可核对本次动作的实际设置范围。'}
      </Typography.Paragraph>
    </>
  )
}
