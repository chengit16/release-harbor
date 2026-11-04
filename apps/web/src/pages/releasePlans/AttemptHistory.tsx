/** @description 执行历史的安全摘要与详情入口，原始执行结果和人工结论分别展示。 */
import { Button, Space, Table, Tag, Typography } from 'antd'
import { attemptMessages, type ReleaseAttempt } from '@release-harbor/contracts'

/** 仅展示已加载安全记录，不在列表发起商店操作。 */
export interface AttemptHistoryProps {
  /** 查询事实由页面 Hook 维护。 */
  attempts: ReleaseAttempt[]
  /** 打开对应记录详情，不会触发执行。 */
  onReview: (id: string) => void
}
/** 历史固定分页，窄屏在表格内部滚动，避免长标识撑开整个页面。 */
export function AttemptHistory({ attempts, onReview }: AttemptHistoryProps) {
  return (
    <section aria-label="执行记录" className="plan-history">
      <h3>执行记录</h3>
      <Table
        rowKey="id"
        dataSource={attempts}
        pagination={{ pageSize: 5, hideOnSinglePage: true, showSizeChanger: false }}
        locale={{ emptyText: '尚无执行记录' }}
        scroll={{ x: 620 }}
        columns={[
          {
            title: '原始结果',
            key: 'result',
            width: 260,
            render: (_, a) => (
              <Space orientation="vertical">
                <Tag
                  color={
                    a.status === 'succeeded'
                      ? 'green'
                      : a.status === 'needs_reconciliation'
                        ? 'orange'
                        : 'default'
                  }
                >
                  {a.status === 'succeeded'
                    ? '草稿已保存'
                    : a.status === 'needs_reconciliation'
                      ? '待核对'
                      : a.finishedAt
                        ? '执行已结束'
                        : '执行中'}
                </Tag>
                <Typography.Paragraph className="attempt-message">
                  {attemptMessages[a.code]}
                </Typography.Paragraph>
                <Typography.Text type="secondary">
                  {new Date(a.createdAt).toLocaleString()}
                </Typography.Text>
              </Space>
            ),
          },
          {
            title: '人工核对',
            key: 'reconciliation',
            width: 230,
            render: (_, a) =>
              a.reconciliation ? (
                <Space orientation="vertical">
                  <Tag color="blue">用户已核对</Tag>
                  <Typography.Text>
                    {a.reconciliation.decision === 'draft_present'
                      ? '草稿已存在；相同安装包不可重复上传'
                      : '未保存且无处理中任务；可创建新计划'}
                  </Typography.Text>
                  <Typography.Text type="secondary">
                    {new Date(a.reconciliation.checkedAt).toLocaleString()}
                  </Typography.Text>
                </Space>
              ) : (
                <Typography.Text type="secondary">
                  {a.status === 'needs_reconciliation' ? '等待到商店后台核对' : '无需核对'}
                </Typography.Text>
              ),
          },
          {
            title: '操作',
            key: 'action',
            width: 90,
            render: (_, a) => (
              <Button type="link" onClick={() => onReview(a.id)}>
                详情
              </Button>
            ),
          },
        ]}
      />
    </section>
  )
}
