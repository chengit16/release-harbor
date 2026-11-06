/** @description 新发布只选择应用及原有操作入口；继续仅导航，不执行准备、上传或审核。 */
import { useState } from 'react'
import { Form, Modal, Select, Typography } from 'antd'
import type { ReleaseCenterProjectOption } from '@release-harbor/contracts'
import { openReleaseWorkspace, releaseApplicationOptions } from './releaseCenterPresentation.ts'

/** 对话框由父页按打开状态挂载，关闭即清理临时选择。 */
interface Props {
  /** 已读取的应用目录。 */
  projects: ReleaseCenterProjectOption[]
  /** 默认采用当前列表的应用筛选。 */
  applicationId: string
  /** 关闭后由 Ant Design 恢复触发按钮焦点。 */
  onClose: () => void
}

/** 单渠道与批次复用已验证流程，iOS 提供独立的已有构建审核入口。 */
export function StartReleaseModal({ projects, applicationId, onClose }: Props) {
  const options = releaseApplicationOptions(projects)
  const [selected, setSelected] = useState(applicationId)
  const [kind, setKind] = useState<'plan' | 'batch' | 'apple'>('plan')
  const application = options.find((item) => item.value === selected)
  return (
    <Modal
      open
      title="发起发布"
      okText="开始配置"
      cancelText="取消"
      onCancel={onClose}
      okButtonProps={{ disabled: !application }}
      onOk={() => {
        if (application) {
          openReleaseWorkspace(application.projectId, application.value, kind)
          onClose()
        }
      }}
    >
      <Form layout="vertical">
        <Form.Item label="发布应用" required>
          <Select
            aria-label="发布应用"
            placeholder="选择项目下的应用"
            showSearch
            optionFilterProp="label"
            value={selected || undefined}
            options={options}
            onChange={(value) => {
              setSelected(value)
              setKind('plan')
            }}
          />
        </Form.Item>
        <Form.Item label="发布方式">
          <Select
            aria-label="本次发布方式"
            value={kind}
            disabled={!application}
            onChange={setKind}
            options={[
              {
                value: 'plan',
                label: application?.platform === 'ios' ? '上传 IPA 构建' : '单渠道发布',
              },
              ...(application?.platform === 'android'
                ? [{ value: 'batch', label: '多渠道批次' }]
                : []),
              ...(application?.platform === 'ios'
                ? [{ value: 'apple', label: '已有构建审核与发布' }]
                : []),
            ]}
          />
        </Form.Item>
      </Form>
      <Typography.Paragraph type="secondary">
        进入配置后填写发布内容，准备并核对摘要，明确确认一次后才执行。
      </Typography.Paragraph>
    </Modal>
  )
}
