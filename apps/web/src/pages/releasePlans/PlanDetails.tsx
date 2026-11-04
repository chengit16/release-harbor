/** @description 公开计划快照的只读复核，不加载秘密或发起远端操作。 */
import { Collapse, Descriptions, Divider, Typography } from 'antd'
import { channelLabels, releaseActions, type ReleasePlan } from '@release-harbor/contracts'

/** 只接收已冻结快照，原文说明与指纹均可核对。 */
export interface PlanDetailsProps {
  /** 服务端生成的安全不可变计划。 */
  plan: ReleasePlan
}
/** 优先展示用户需要确认的目标、安装包、说明与期限；账号引用及指纹按需展开。 */
export function PlanDetails({ plan }: PlanDetailsProps) {
  const s = plan.snapshot
  return (
    <div className="plan-details">
      <Descriptions
        bordered
        styles={{
          label: { width: 100, whiteSpace: 'nowrap' },
          content: { overflowWrap: 'anywhere' },
        }}
        size="small"
        column={1}
        items={[
          {
            key: 'app',
            label: '应用身份',
            children: `${s.application.name} · ${s.application.identifier}`,
          },
          {
            key: 'store',
            label: '商店目标',
            children: `${channelLabels[s.binding.channel]} · ${s.binding.channel === 'xiaomi' ? '包名' : 'App ID'} ${s.binding.appId}`,
          },
          { key: 'action', label: '计划动作', children: releaseActions[s.action] },
          {
            key: 'release-policy',
            label: '上架类型',
            children: s.releasePolicy
              ? s.releasePolicy.mode === 'after_approval'
                ? '审核通过后立即上架'
                : `指定时间上架：${new Date(s.releasePolicy.notBefore).toLocaleString()}（${Intl.DateTimeFormat().resolvedOptions().timeZone}，审核通过且不早于此时间）`
              : '历史计划未记录上架选择',
          },
          {
            key: 'policy-scope',
            label: '设置范围',
            children:
              s.action === 'xiaomi_submit_review'
                ? '本次提交将向小米发送上架选择；受理不代表已上架'
                : '当前动作尚不设置商店上架策略；选择仅记录到计划',
          },
          {
            key: 'artifact',
            label: '安装包',
            children: `${s.artifact.fileName} · ${s.artifact.identity?.versionName} (${s.artifact.identity?.buildNumber})`,
          },
          {
            key: 'expires',
            label: '摘要有效期',
            children: s.preflight.expiresAt
              ? new Date(s.preflight.expiresAt).toLocaleString()
              : '已失效',
          },
        ]}
      />
      {s.xiaomi && (
        <Descriptions
          column={1}
          size="small"
          items={[
            ...(s.xiaomi.source
              ? [
                  {
                    key: 'material-source',
                    label: '资料来源',
                    children: `自动复用小米公开上架资料 · ${new Date(s.xiaomi.source.checkedAt).toLocaleString()}`,
                  },
                ]
              : []),
            { key: 'store-name', label: '小米后台应用名称', children: s.xiaomi.appName },
            { key: 'privacy', label: '隐私政策', children: s.xiaomi.privacyUrl },
            {
              key: 'icon',
              label: '提交图标',
              children: (
                <img
                  src={'data:image/png;base64,' + s.xiaomi.iconBase64}
                  alt="本次提交的小米图标"
                  width={64}
                  height={64}
                />
              ),
            },
            {
              key: 'testing',
              label: '测试材料',
              children: '使用本次账号档案内的审核说明与测试登录材料；内容不在页面回显',
            },
          ]}
        />
      )}
      <Divider titlePlacement="start">更新说明</Divider>
      <Typography.Paragraph className="plan-release-notes">{s.releaseNotes}</Typography.Paragraph>
      <Collapse
        items={[
          {
            key: 'details',
            label: '更多核对信息',
            children: (
              <Descriptions
                column={1}
                size="small"
                items={[
                  { key: 'reference', label: '账号引用', children: s.binding.credentialReference },
                  { key: 'revision', label: '绑定版本', children: s.binding.revision },
                  {
                    key: 'confirmed',
                    label: '原确认截止',
                    children: plan.authorization
                      ? new Date(plan.authorization.expiresAt).toLocaleString()
                      : '尚未确认',
                  },
                  { key: 'digest', label: '计划 SHA-256', children: plan.digest },
                  { key: 'file', label: '产物 SHA-256', children: s.artifact.sha256 },
                  { key: 'notes', label: '说明 SHA-256', children: s.notesDigest },
                  { key: 'config', label: '配置 SHA-256', children: s.configDigest },
                  { key: 'profile', label: '凭据目录版本', children: s.preflight.profileRevision },
                ]}
              />
            ),
          },
        ]}
      />
    </div>
  )
}
