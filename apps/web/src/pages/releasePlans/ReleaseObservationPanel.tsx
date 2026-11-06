/** @description 发布详情内的版本级商店观察；导航只读历史，用户点击才查询荣耀，不更改原执行事实。 */
import { Alert, Button, Card, Collapse, Space, Tag, Typography } from 'antd'
import {
  releaseObservationStates,
  releaseObservationCodes,
  type ReleasePlan,
} from '@release-harbor/contracts'
import { useReleaseObservations } from './useReleaseObservations.ts'
/** 目标只来自已加载计划；计划 ID 不自动构成查询或执行授权。 */
interface Props {
  plan: ReleasePlan
}
/** 每次进入只恢复本机观察；终态不重复查询，历史与新失败分别保留。 */
export function ReleaseObservationPanel({ plan }: Props) {
  const { records, loading, busy, error, latest, successful, terminal, cooling, query, refresh } =
    useReleaseObservations(plan)
  return (
    <Card size="small" title="商店状态观察" className="form-feedback">
      <Typography.Paragraph type="secondary">
        仅查询本次版本的当前状态，与原执行回执分别保留。来源：荣耀 API；页面刷新不会查询商店。
      </Typography.Paragraph>
      {error && <Alert role="alert" showIcon type="error" title={error} />}
      <Space wrap>
        <Button
          loading={busy}
          disabled={loading || !!terminal || cooling}
          onClick={() => void query()}
        >
          查询荣耀状态
        </Button>
        <Button loading={loading} disabled={busy} onClick={refresh}>
          重读本机观察
        </Button>
      </Space>
      {loading ? (
        <p role="status">正在读取本机观察…</p>
      ) : !latest ? (
        <p>尚未查询本次版本的商店状态。</p>
      ) : (
        <>
          <Typography.Paragraph>
            <Tag
              color={
                latest.state === 'rejected'
                  ? 'error'
                  : latest.code !== 'observed' || latest.state === 'unknown'
                    ? 'warning'
                    : latest.state === 'approved' || latest.state === 'published'
                      ? 'success'
                      : 'processing'
              }
            >
              {releaseObservationStates[latest.state]}
            </Tag>
            {releaseObservationCodes[latest.code]}
          </Typography.Paragraph>
          <Typography.Paragraph type="secondary">
            版本 {latest.versionName} ({latest.buildNumber}) · 查询时间：
            {new Date(latest.checkedAt).toLocaleString()}（非实时）
          </Typography.Paragraph>
          {latest.code === 'observed' && latest.state === 'unknown' && (
            <Typography.Paragraph>
              荣耀返回的阶段暂无法归类，请到后台核对；原始状态码可在观察历史查看。
            </Typography.Paragraph>
          )}
          {latest.state === 'rejected' && (
            <Typography.Paragraph>
              请到荣耀开发者后台查看具体审核意见并完善资料；本页不展示私人审核文本或附件。
            </Typography.Paragraph>
          )}
          {latest.state === 'approved' && (
            <Typography.Paragraph>
              审核通过尚不代表已上架；查询间隔结束后可继续核对上架情况，或前往商店后台查看。
            </Typography.Paragraph>
          )}
          {terminal ? (
            <Typography.Paragraph type="secondary">
              已取得该版本的确定结论，无需重复查询；后续上架情况请到商店后台核对。
            </Typography.Paragraph>
          ) : (
            <Typography.Paragraph type="secondary">
              下次可显式查询：{new Date(latest.nextQueryAt).toLocaleString()}
              ，到时重读本机观察后可再次查询。系统不会自动查询。
            </Typography.Paragraph>
          )}
          {latest.code !== 'observed' && successful && (
            <Typography.Paragraph>
              上次成功观察：{releaseObservationStates[successful.state]} ·{' '}
              {new Date(successful.checkedAt).toLocaleString()}；本次查询失败未覆盖该记录。
            </Typography.Paragraph>
          )}
          <Collapse
            size="small"
            ghost
            items={[
              {
                key: 'history',
                label: `查看观察历史（${records.length} 条）`,
                children: records.map((record) => (
                  <Typography.Paragraph key={record.id}>
                    {new Date(record.checkedAt).toLocaleString()} ·{' '}
                    {releaseObservationStates[record.state]} ·{' '}
                    {releaseObservationCodes[record.code]}
                    {record.rawState === null ? '' : `（平台状态码 ${record.rawState}）`}
                  </Typography.Paragraph>
                )),
              },
            ]}
          />
        </>
      )}
    </Card>
  )
}
