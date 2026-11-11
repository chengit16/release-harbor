/** @description Apple 审核或手动上线摘要；一个明确确认，不将送审受理显示成审核通过。 */
import { useEffect, useState } from 'react'
import { Alert, Button, Checkbox, Descriptions, Drawer, Typography } from 'antd'
import { appleReviewMessages, type AppleReviewRecord } from '@release-harbor/contracts'
import { TeamRecordAudit } from '../team/TeamRecordAudit.tsx'
import { useTeamAccess } from '../team/teamAccess.tsx'

/** 只展示服务端不可变摘要；onExecute 不接收用户重写目标。 */
export interface AppleReviewSummaryProps {
  /** 历史或本次准备的快照。 */ record: AppleReviewRecord | undefined
  /** 操作进行中禁止重复。 */ busy: boolean
  /** 原位失败反馈。 */ error: string
  /** 关闭不消费确认。 */ onClose: () => void
  /** 仅用户明确同意后执行。 */ onExecute: (
    r: AppleReviewRecord,
  ) => Promise<AppleReviewRecord | null>
}
/** 有效期由服务器最终核对；已消费的计划不允许从摘要再次触发。 */
export function AppleReviewSummary({
  record: r,
  busy,
  error,
  onClose,
  onExecute,
}: AppleReviewSummaryProps) {
  const access = useTeamAccess()
  const [ack, setAck] = useState(false)
  useEffect(() => setAck(false), [r?.id])
  const s = r?.snapshot
  return (
    <Drawer
      title="Apple 发布摘要"
      open={!!r}
      onClose={onClose}
      size="large"
      styles={{ wrapper: { maxWidth: '100vw' } }}
      extra={<Button onClick={onClose}>关闭摘要</Button>}
    >
      {r && s && (
        <>
          <TeamRecordAudit
            key={r.id}
            projectId={s.binding.projectId}
            applicationId={s.binding.applicationId}
            kind="apple"
            recordId={r.id}
            version={r.reconciliation?.checkedAt ?? r.finishedAt ?? r.status}
          />
          <Alert
            className="form-feedback"
            showIcon
            type={r.status === 'unknown' ? 'warning' : 'info'}
            title={appleReviewMessages[r.code]}
            description={
              s.action === 'submit'
                ? '确认将绑定所选构建、更新现有语种说明及发布方式并提交审核，不会重新上传 IPA。Apple 仍会校验隐私、评级、合同和其他合规资料。'
                : '确认将请求 Apple 发布已批准且待开发者发布的版本；受理后无法由本工作台撤销，实际生效以商店状态为准。'
            }
          />
          {error && <Alert role="alert" type="error" showIcon title={error} />}
          <Descriptions
            bordered
            column={1}
            items={[
              { key: 'target', label: '商店目标', children: `App ID ${s.binding.appId}` },
              { key: 'bundle', label: 'Bundle ID', children: s.identifier },
              {
                key: 'build',
                label: '已有构建',
                children: `${s.build.version} (${s.build.number})`,
              },
              {
                key: 'action',
                label: '动作',
                children: s.action === 'submit' ? '提交审核' : '请求手动发布',
              },
              {
                key: 'mode',
                label: '发布方式',
                children: s.mode === 'manual' ? '审核通过后手动发布' : '审核通过后自动发布',
              },
              { key: 'version', label: '商店来源状态', children: s.version.state },
              {
                key: 'locales',
                label: '更新说明语种',
                children: s.locales.length
                  ? s.locales.join('、') + '（各语种使用本次相同说明）'
                  : '本次不修改说明',
              },
              {
                key: 'materials',
                label: '资料写入范围',
                children:
                  s.action === 'submit'
                    ? '仅关联构建、更新上述现有语种的更新说明及发布方式；名称、介绍、截图、隐私与合规资料在官方后台维护，修改后重新准备'
                    : '仅请求发布已批准版本，不再次修改资料、上传或送审',
              },
              { key: 'time', label: '检查时间', children: new Date(s.checkedAt).toLocaleString() },
              {
                key: 'expires',
                label: '确认有效期',
                children: new Date(r.expiresAt).toLocaleString(),
              },
            ]}
          />
          {s.action === 'submit' && (
            <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginTop: 16 }}>
              {s.notes}
            </Typography.Paragraph>
          )}
          {r.status === 'ready' && (
            <>
              <Checkbox checked={ack} disabled={busy} onChange={(e) => setAck(e.target.checked)}>
                我已核对应用、版本、构建和发布方式，同意执行本次 Apple 操作
              </Checkbox>
              <div className="plan-review-actions">
                <Button
                  type="primary"
                  loading={busy}
                  disabled={
                    !access.can(
                      r.snapshot.binding,
                      'release_confirm',
                      r.snapshot.action === 'release' ? 'apple_release' : 'apple_submit_review',
                    ) ||
                    !ack ||
                    busy ||
                    Date.now() >= Date.parse(r.expiresAt)
                  }
                  onClick={() =>
                    void onExecute(r).then((v) => {
                      if (v) onClose()
                    })
                  }
                >
                  {s.action === 'submit' ? '确认提交 Apple 审核' : '确认请求手动发布'}
                </Button>
              </div>
            </>
          )}
          <Typography.Paragraph type="secondary">
            关闭不授权。结果不明时先核对 Apple 后台，不重复提交。
          </Typography.Paragraph>
        </>
      )}
    </Drawer>
  )
}
