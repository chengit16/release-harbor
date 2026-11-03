/** @description 分页预检历史只展示可读摘要，查看详情经回调选择已有记录，不运行或重试预检。 */
import { useState } from 'react'
import { Button, Card, Empty, Table, Tag, Typography, type TableColumnsType } from 'antd'
import type { PreflightView } from '@release-harbor/contracts'
import { useCompactLayout } from '../../app/useCompactLayout.ts'
import {
  preflightAccount,
  preflightArtifact,
  preflightStatus,
  preflightTime,
  type PreflightContext,
} from './preflightPresentation.ts'

/** 已排序的历史事实及当前公开标签。 */
export interface PreflightHistoryProps {
  /** 所有记录按最新在前排列；每页五条，只限制呈现，不删除历史。 */
  views: PreflightView[]
  /** 不保存历史名称快照，缺失关联时显示兜底。 */
  context: PreflightContext
  /** 打开详情，不更改记录或重新提交。 */
  onDetails: (id: string) => void
}

/** 轮询更新保留当前页，记录减少时校正页码；窄屏将账号和时间合并以避免横向溢出。 */
export function PreflightHistory({ views, context, onDetails }: PreflightHistoryProps) {
  const compact = useCompactLayout()
  const [page, setPage] = useState(1)
  const current = Math.min(page, Math.max(1, Math.ceil(views.length / 5)))
  const columns: TableColumnsType<PreflightView> = [
    {
      title: compact ? '检查记录' : '发起时间',
      key: 'time',
      width: compact ? undefined : 175,
      render: (_, view) => (
        <div className="preflight-table-record">
          {compact && <Typography.Text strong>{preflightAccount(view, context)}</Typography.Text>}
          <span>{preflightTime(view.record.createdAt)}</span>
        </div>
      ),
    },
    ...(!compact
      ? [
          {
            title: '商店账号',
            key: 'account',
            className: 'preflight-account-cell',
            render: (_: unknown, view: PreflightView) => preflightAccount(view, context),
          },
          {
            title: '安装包版本',
            key: 'artifact',
            render: (_: unknown, view: PreflightView) => {
              const artifact = preflightArtifact(view, context)
              return (
                <div className="preflight-table-record">
                  <Typography.Text>{artifact.version}</Typography.Text>
                  <Typography.Text type="secondary">{artifact.fileName}</Typography.Text>
                </div>
              )
            },
          },
        ]
      : []),
    {
      title: '结果',
      key: 'status',
      width: compact ? 104 : 154,
      render: (_, view) => {
        const status = preflightStatus(view)
        return (
          <Tag color={status.color} className="preflight-status-tag">
            {status.text}
          </Tag>
        )
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 64,
      render: (_, view) => (
        <Button size="small" type="link" onClick={() => onDetails(view.record.id)}>
          详情
        </Button>
      ),
    },
  ]
  return (
    <section aria-label="预检历史">
      <Card
        title={
          <h2>
            预检历史 <Typography.Text type="secondary">{views.length} 条</Typography.Text>
          </h2>
        }
      >
        <Table<PreflightView>
          size="small"
          rowKey={(view) => view.record.id}
          columns={columns}
          tableLayout="fixed"
          dataSource={views}
          locale={{
            emptyText: (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚无只读预检记录" />
            ),
          }}
          pagination={{
            current,
            pageSize: 5,
            showSizeChanger: false,
            hideOnSinglePage: true,
            simple: compact,
            onChange: setPage,
            showTotal: (total) => `共 ${total} 条记录`,
          }}
        />
      </Card>
    </section>
  )
}
