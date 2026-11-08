/** @description 商店接入指南，只展示公开的适配范围，区分工程接入、用户后台反馈与待验收。 */
import { useState } from 'react'
import { Button, Card, Flex, Select, Table, Tag, Typography } from 'antd'
import type { TableColumnsType } from 'antd'
import { channelCapabilities, type ChannelCapability } from '@release-harbor/contracts'
import { PageHelp } from '../../components/PageHelp.tsx'
import { updateUrlState } from '../../app/useUrlState.ts'
import { useCompactLayout } from '../../app/useCompactLayout.ts'

const columns: TableColumnsType<ChannelCapability> = [
  {
    title: '渠道',
    dataIndex: 'name',
    key: 'name',
    render: (name: string) => <h2 className="channel-table-title">{name}</h2>,
  },
  {
    title: '产物',
    dataIndex: 'artifact',
    key: 'artifact',
    render: (value: string) => <Tag>{value}</Tag>,
  },
  { title: '支持动作', dataIndex: 'plannedAction', key: 'action' },
  {
    title: '接入状态',
    key: 'status',
    render: (_, channel) => (
      <Tag
        color={
          channel.acceptance === 'user_confirmed'
            ? 'success'
            : channel.implemented
              ? 'processing'
              : 'default'
        }
      >
        {channel.acceptance === 'user_confirmed'
          ? '已接入 · 用户后台确认'
          : channel.implemented
            ? '工程已接入 · 待真实验收'
            : '待接入'}
      </Tag>
    ),
  },
]

/** 使用表格比较目标动作，配置能力与真实执行能力分别表达。
 * 长函数保留原因：桌面表格、手机卡片和渠道限制共同组成同一只读指南，保持相邻便于核对事实一致性。 */
export function ChannelsPage() {
  const [channel, setChannel] = useState('')
  const compact = useCompactLayout()
  const visible = channelCapabilities.filter((item) => !channel || item.id === channel)
  return (
    <div className="help-guide">
      <Flex wrap gap={8} className="help-task-links">
        <Button onClick={() => updateUrlState({ view: 'projects', project: '', application: '' })}>
          配置应用与渠道
        </Button>
        <Button onClick={() => updateUrlState({ view: 'accounts' })}>配置商店账号</Button>
        <Button onClick={() => updateUrlState({ view: 'releases' })}>前往发布中心</Button>
        <Button onClick={() => updateUrlState({ view: 'reviews', reviewMode: '' })}>
          查询审核状态
        </Button>
      </Flex>
      <Card title="商店接入能力" extra={<Tag color="success">第四期工程交付</Tag>}>
        <Select
          aria-label="指南渠道"
          placeholder="全部渠道"
          allowClear
          value={channel || undefined}
          onChange={(value) => setChannel(value ?? '')}
          options={channelCapabilities.map((item) => ({ value: item.id, label: item.name }))}
          style={{ width: '100%', maxWidth: 320, marginBottom: 16 }}
        />
        {compact ? (
          <Flex vertical gap={12}>
            {visible.map((item) => (
              <Card
                size="small"
                key={item.id}
                title={<h2 className="channel-table-title">{item.name}</h2>}
              >
                <Tag>{item.artifact}</Tag>
                <Typography.Paragraph>{item.plannedAction}</Typography.Paragraph>
                <Typography.Text type="secondary">
                  {item.acceptance === 'user_confirmed'
                    ? '已接入 · 用户后台确认'
                    : item.implemented
                      ? '工程已接入 · 待真实验收'
                      : '待接入'}
                </Typography.Text>
              </Card>
            ))}
          </Flex>
        ) : (
          <Table<ChannelCapability>
            rowKey="id"
            columns={columns}
            dataSource={visible}
            pagination={false}
            scroll={{ x: 600 }}
            size="middle"
          />
        )}
        <PageHelp title="渠道差异与使用限制">
          <section className="guide-note">
            <h3>华为 Android 可选择保存草稿或提交审核</h3>
            <p>
              单渠道明确选择提交审核后，系统沿用已有资料、更新 APK
              与默认语言说明，等待至少两分钟再送审。支持审核后立即／指定时间上架；后台已有草稿或在审版本须先处理。新增送审待真实验收，多渠道批次仍保存草稿。
            </p>
          </section>
          <section className="guide-note">
            <h3>
              发布入口已统一到发布中心。“审核状态 →
              商店状态”直接从已绑定应用读取官方版本，无需先在本机发布，官网手动提交的版本也可查询。原执行和观察保留在“本地发布关联”。
            </h3>
          </section>
          <section className="guide-note">
            <h3>审核通过与已上架分别核对</h3>
            <p>
              魅族、荣耀、Apple、vivo、华为 Android
              与鸿蒙支持已核实状态。应用宝分别展示审核流程和版本资料；OPPO
              按官方字典展示返回版本的审核与阶段状态，资质／运营通过不代表整包通过，请核对版本和构建号。小米只显示公开在架版本，暂不提供审核进度。页面标记查询时间和范围，刷新只读本机缓存，可在详情按
              OPPO 构建号定位或补充小米人工核对；待办处理基于已有记录整理。
            </p>
          </section>
          <section className="guide-note">
            <h3>确认摘要明确资料修改范围与语种</h3>
            <p>
              日常只填写更新说明，其他资料按渠道要求复用；名称、截图、隐私及合规的主动修改在官方后台维护后重新准备。OPPO
              版本处理、vivo 更新受理与审核通过分开呈现。秒级定时向后取整；OPPO／vivo
              时区为工程映射，须核对后台时间。本项目 iOS
              只提供自动／手动发布，实际策略及上架须逐版本验收。
            </p>
          </section>
        </PageHelp>
        <p className="capability-note">
          上游 SDK
          的支持范围与产品已实现能力分别管理，工程测试与真实渠道验收分别记录，提交审核不代表审核通过或上架。
        </p>
      </Card>
    </div>
  )
}
