/** @description 根据不可变计划展示本次资料写入与策略证据边界；不读取商店、不修改摘要或扩大授权。 */
import { Alert, Descriptions } from 'antd'
import type { ReleasePlanSnapshot } from '@release-harbor/contracts'

/** 只展示服务端已冻结的计划，不接受表单草稿来替换确认内容。 */
export interface PlanWriteScopeProps {
  /** 语言与动作来自同一快照，旧记录缺字段时明确保留限制。 */
  snapshot: ReleasePlanSnapshot
}

/** 日常更新限定说明与已有资源复用；其他商店资料在官方后台维护，修改后重新准备。 */
export function PlanWriteScope({ snapshot: s }: PlanWriteScopeProps) {
  const isUpload = s.action === 'apple_upload_build'
  const language = s.huawei?.defaultLang ?? s.harmony?.defaultLang ?? s.honor?.defaultLanguage
  const writes = isUpload
    ? '上传 IPA；更新说明仅保存在本机计划，不写入 App Store 商店资料'
    : s.action === 'huawei_save_draft'
      ? '上传 APK 并保存草稿；本页不承诺指定语种资料已同步'
      : s.xiaomi
        ? '新 APK、更新说明；重新提交摘要中的现有名称、隐私政策与图标，使用账号内的审核测试材料'
        : s.oppo || s.meizu
          ? '新 APK、更新说明；按平台要求重新提交现有资料，私人审核材料只在执行器内复用'
          : '新安装包与更新说明；其余商店资料沿用后台'
  const timing = ['oppo', 'vivo'].includes(s.binding.channel)
    ? '按 Asia/Shanghai 转换发送；官方未明确无时区字段的时区，请在商店后台核对实际设置。秒级接口向后取整，不早于确认时刻。'
    : s.binding.channel === 'xiaomi'
      ? '按确认时刻的毫秒时间戳发送；公开在架查询不能证明新版本审核进度或定时设置。'
      : s.binding.channel === 'tencent'
        ? '按 UTC 秒时间戳发送；秒级接口向后取整，不早于确认时刻。'
        : '按明确 UTC 偏移发送；秒级接口向后取整，不早于确认时刻。'
  return (
    <section aria-label="本次资料与策略范围" style={{ marginBlockStart: 16 }}>
      <Descriptions
        size="small"
        column={1}
        items={[
          { key: 'writes', label: '资料写入范围', children: writes },
          {
            key: 'language',
            label: '说明修改语种',
            children:
              isUpload || s.action === 'huawei_save_draft'
                ? '当前动作不设置指定语种'
                : language
                  ? `${language}（仅默认语种，其他语种保留）`
                  : '此渠道接口不单独选择语种，沿用其现有资料范围',
          },
          {
            key: 'backend',
            label: '其他资料修改',
            children:
              '名称、介绍、截图、图标、隐私及合规资料的主动修改请到官方后台处理，完成后重新准备；本次不新增资源或生成翻译',
          },
        ]}
      />
      <Alert
        className="form-feedback"
        showIcon
        type="info"
        title="策略意图与远端结果分开核对"
        description={
          isUpload || s.action === 'huawei_save_draft'
            ? '本次仅记录上架意图，不设置商店发布策略。'
            : s.binding.channel === 'meizu'
              ? '魅族没有公开定时字段，按默认审核发布流程处理；送审回执不等于审核通过或上架。'
              : `${s.releasePolicy?.mode === 'scheduled' ? timing : '上架选择随本次提交发送。'}受理回执仅证明本次动作阶段，不证明审核通过、定时生效或已经上架；请在审核状态或官方后台核对。`
        }
      />
    </section>
  )
}
