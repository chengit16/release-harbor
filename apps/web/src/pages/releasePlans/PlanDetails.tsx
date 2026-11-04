/** @description 公开计划快照的只读复核，不加载秘密或发起远端操作。 */
import { Collapse, Descriptions, Divider, Typography } from 'antd'
import { releaseActions, type ReleasePlan } from '@release-harbor/contracts'

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
            children: `${s.binding.channel === 'huawei' ? '华为 AppGallery' : 'Apple App Store'} · App ID ${s.binding.appId}`,
          },
          { key: 'action', label: '计划动作', children: releaseActions[s.action] },
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
