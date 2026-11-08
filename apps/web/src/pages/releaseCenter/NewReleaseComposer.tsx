/** @description 新发布统一选渠道；单选沿用单计划，多选进入独立批次确认，导航不产生授权。 */
import { useState } from 'react'
import { Alert, Button, Card, Flex, Popconfirm, Select, Spin, Typography } from 'antd'
import { channelLabels, type Application } from '@release-harbor/contracts'
import { updateUrlState, useUrlState } from '../../app/useUrlState.ts'
import { useBindings } from '../applications/useApplicationData.ts'
import { ReleasePlansPanel } from '../releasePlans/ReleasePlansPanel.tsx'

/** 渠道选择只保存公开绑定 ID；执行时仍核对完整归属和版本。
 * 长函数保留原因：配置缺项、选择与已选摘要互斥，发布业务保留在独立面板，避免切换时产生隐式准备。 */
export function NewReleaseComposer({
  application,
}: {
  /** 当前可信应用。 */ application: Application
}) {
  const data = useBindings(application.projectId, application.id),
    params = useUrlState()
  const configured = params.get('releaseCompose') === 'configured'
  const ids = (params.get('releaseSelected') ?? '').split(',').filter(Boolean)
  const [selection, setSelection] = useState<string[]>(ids)
  const selected = data.items.filter((item) => ids.includes(item.id))
  if (data.loading) return <Spin aria-label="正在读取发布渠道" />
  if (data.error)
    return (
      <Alert
        type="error"
        title={data.error}
        action={<Button onClick={data.refresh}>重新读取渠道</Button>}
      />
    )
  if (configured && (selected.length !== ids.length || !ids.length))
    return (
      <Alert
        type="warning"
        title="原选择的渠道配置已变化，请重新选择。"
        action={
          <Button onClick={() => updateUrlState({ releaseCompose: '1', releaseSelected: '' })}>
            重新选择渠道
          </Button>
        }
      />
    )
  if (configured)
    return (
      <Flex vertical gap={16}>
        <Flex wrap gap={8} align="center">
          <Typography.Text>
            本次渠道：
            {selected.map((item) => `${channelLabels[item.channel]} · ${item.appId}`).join('、')}
          </Typography.Text>
          <Popconfirm
            title="更改渠道会清除当前未保存的发布内容，已保存记录保留。"
            onConfirm={() =>
              updateUrlState({
                releaseCompose: '1',
                releaseSelected: '',
                plan: '',
                batch: '',
                batchRevision: '',
              })
            }
          >
            <Button>更改渠道</Button>
          </Popconfirm>
        </Flex>
        <ReleasePlansPanel key={ids.join(':')} application={application} selectedBindings={ids} />
      </Flex>
    )
  return (
    <Card title="选择本次发布渠道">
      <Flex vertical gap={16}>
        <Typography.Text type="secondary">
          选择一个渠道发起发布；Android 可同时选择多个渠道，系统生成一份批次摘要。
        </Typography.Text>
        <Select
          mode={application.platform === 'android' ? 'multiple' : undefined}
          aria-label="本次发布渠道"
          placeholder="选择已配置渠道"
          value={application.platform === 'android' ? selection : selection[0]}
          options={data.items.map((item) => ({
            value: item.id,
            label: channelLabels[item.channel],
          }))}
          onChange={(value: string | string[]) =>
            setSelection(Array.isArray(value) ? value : [value])
          }
        />
        {selection.length > 1 &&
          data.items.some((item) => selection.includes(item.id) && item.channel === 'huawei') && (
            <Alert
              type="warning"
              showIcon
              title="本批次的华为渠道仅保存草稿"
              description="如需正式提交华为审核，请单独选择华为，在下一步明确选择“提交审核”。其他渠道按摘要提交更新。"
            />
          )}
        {!data.items.length && (
          <Alert
            type="info"
            title="请先配置发布渠道"
            action={
              <Button
                onClick={() =>
                  updateUrlState({
                    view: 'projects',
                    project: application.projectId,
                    application: application.id,
                    tab: 'bindings',
                    releaseTask: '',
                  })
                }
              >
                配置渠道与账号
              </Button>
            }
          />
        )}
        <Button
          type="primary"
          disabled={
            !selection.length || selection.some((id) => !data.items.some((item) => item.id === id))
          }
          onClick={() =>
            updateUrlState({
              releaseCompose: 'configured',
              releaseSelected: selection.join(','),
              releaseView: selection.length > 1 ? 'batch' : '',
            })
          }
        >
          继续填写发布内容
        </Button>
      </Flex>
    </Card>
  )
}
