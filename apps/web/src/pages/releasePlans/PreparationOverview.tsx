/** @description 发布编辑期间的只读概览，仅解释当前草稿；不代替服务端冻结摘要和执行确认。 */
import { Collapse, Typography } from 'antd'
import { channelLabels, type ArtifactRecord, type ChannelBinding } from '@release-harbor/contracts'
import { useCompactLayout } from '../../app/useCompactLayout.ts'

/** 草稿字段由原 Form 订阅提供，缺项明确显示，不能把本机可选材料当成商店权限通过。 */
export function PreparationOverview({
  binding,
  artifact,
  mode,
  huaweiAction,
}: {
  /** 当前选择的公开绑定，尚未选择时省略。 */ binding: ChannelBinding | undefined
  /** 当前选择的安装包公开身份。 */ artifact: ArtifactRecord | undefined
  /** 草稿中的上架意图，未选择时省略。 */ mode: string | undefined
  /** 华为草稿与正式送审分开表达。 */ huaweiAction: string | undefined
}) {
  const compact = useCompactLayout()
  const content = (
    <>
      <dl>
        <div>
          <dt>目标渠道</dt>
          <dd>{binding ? channelLabels[binding.channel] : '待选择渠道'}</dd>
        </div>
        <div>
          <dt>版本与构建</dt>
          <dd>
            {artifact
              ? `${artifact.identity?.versionName ?? '未提供'} · ${artifact.identity?.buildNumber ?? '未提供'}`
              : '待选择检查通过的安装包'}
          </dd>
        </div>
        <div>
          <dt>实际执行动作</dt>
          <dd>
            {!binding
              ? '选择渠道后显示'
              : binding.channel === 'app_store'
                ? '上传构建，尚不送审'
                : binding.channel === 'huawei' && huaweiAction !== 'submit_review'
                  ? '保存华为草稿，尚不送审'
                  : '上传更新并提交审核'}
          </dd>
        </div>
        <div>
          <dt>上架意图</dt>
          <dd>
            {mode === 'manual'
              ? '审核通过后手动发布'
              : mode === 'scheduled'
                ? '指定时间上架，请核对表单时间'
                : mode === 'after_approval'
                  ? binding?.channel === 'app_store'
                    ? '审核通过后自动发布'
                    : '审核通过后立即上架'
                  : '待选择'}
          </dd>
        </div>
      </dl>
      <Typography.Text type="secondary">
        准备时自动核对账号、目标和安装包；准备完成后仍须核对冻结摘要并明确确认。上架设置的实际范围以摘要为准。
      </Typography.Text>
    </>
  )
  return (
    <aside className="release-form-summary" aria-label="本次发布概览">
      {compact ? (
        <Collapse
          ghost
          size="small"
          items={[{ key: 'draft', label: '草稿概览（非执行授权）', children: content }]}
        />
      ) : (
        <>
          <h4>草稿概览</h4>
          {content}
        </>
      )}
    </aside>
  )
}
