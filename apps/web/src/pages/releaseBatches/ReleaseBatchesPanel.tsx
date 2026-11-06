/** @description 应用内多商店批次入口；选择、准备、一次确认和逐项回执，URL 只保存公开定位。 */
import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Card, Flex, Space, Tag, Typography } from 'antd'
import {
  channelLabels,
  type Application,
  type BatchTargetInput,
  type ReleaseBatch,
} from '@release-harbor/contracts'
import { useUrlState, updateUrlState } from '../../app/useUrlState.ts'
import { reconcileReleaseAttempt } from '../../api/services/releasePlans.ts'
import { AttemptReview } from '../releasePlans/AttemptReview.tsx'
import { BatchHistory } from './BatchHistory.tsx'
import { BatchForm } from './BatchForm.tsx'
import { BatchReview, batchStatusLabels } from './BatchReview.tsx'
import { useReleaseBatches } from './useReleaseBatches.ts'

/** 长函数保留原因：页面只组合同一批次的查看和交互，数据请求及历史、配置、摘要均已独立。
 * 同一个 Android 应用，所有写动作均须由表单或摘要显式触发。 */
export function ReleaseBatchesPanel({ application }: { application: Application }) {
  // 1. 只读历史与 URL 定位独立于用户的编辑、确认和核对操作。
  const data = useReleaseBatches(application),
    params = useUrlState(),
    selected = params.get('batch') ?? '',
    batch = data.batches.find((b) => b.id === selected),
    [review, setReview] = useState(''),
    [editing, setEditing] = useState(false),
    [selectedAttempt, setSelectedAttempt] = useState(''),
    [localError, setLocalError] = useState(''),
    opening = useRef(''),
    opened = useRef('')
  const latest = batch?.revisions.at(-1),
    revision = batch?.revisions.find((r) => r.id === review),
    active = batch?.revisions.some((r) => r.preparedAt === null || (r.run && !r.run.finishedAt)),
    attempt = data.attempts.find((a) => a.id === selectedAttempt)
  useEffect(() => {
    if (
      batch &&
      latest?.preparedAt &&
      opening.current === batch.id &&
      opened.current !== latest.id
    ) {
      opened.current = latest.id
      setReview(latest.id)
      setEditing(false)
    }
  }, [batch, latest])
  function channelLabel(bindingId: string): string {
    const binding = data.bindings.find((b) => b.id === bindingId)
    return binding ? channelLabels[binding.channel] : '绑定已变更'
  }
  // 2. 草稿先持久化，再发起一次准备；失败保留原输入及请求编号。
  async function prepare(targets: BatchTargetInput[]) {
    let current: ReleaseBatch | null = batch ?? null
    if (current && editing) current = await data.edit(current, targets)
    else current = await data.create(targets)
    if (!current) return
    opening.current = current.id
    const prepared = await data.prepare(current)
    if (prepared) setEditing(false)
  }
  // 3. 编排独立表单、摘要和人工核对；切换与关闭只影响查看。
  return (
    <section aria-label="多渠道发布批次">
      <Flex vertical gap={20} style={{ width: '100%', minWidth: 0 }}>
        <Alert
          type="info"
          showIcon
          title="一份摘要，确认一次，逐渠道执行"
          description="首版支持同一 Android 应用的最多 7 个已绑定商店。相同版本可使用不同 APK，各渠道结果独立保存；成功不重发，未知结果先核对。"
        />
        <div className="section-title">
          <Typography.Title level={4} style={{ margin: 0 }}>
            Android 多渠道批次
          </Typography.Title>
          <Space wrap>
            <Button onClick={data.refresh} disabled={data.busy}>
              重新读取批次
            </Button>
            <Button
              onClick={() => {
                updateUrlState({ batch: '' })
                setEditing(false)
                setReview('')
                opening.current = ''
              }}
              disabled={data.busy || active}
            >
              新建批次
            </Button>
          </Space>
        </div>
        {(data.error || localError) && (
          <Alert type="error" showIcon role="alert" title={data.error || localError} />
        )}
        {!data.loading && (!batch || editing) && (
          <BatchForm
            key={batch?.id + ':' + batch?.editVersion}
            bindings={data.bindings}
            artifacts={data.artifacts}
            disabled={data.busy || !!active}
            initial={
              editing
                ? batch?.draft.filter((input) => {
                    const target = latest?.targets.find(
                      (t) => t.input.bindingId === input.bindingId,
                    )
                    const receipt = data.attempts.find((a) => a.id === target?.attemptId)
                    return (
                      !target ||
                      !['succeeded', 'needs_reconciliation'].includes(target.status) ||
                      ['no_draft', 'not_submitted', 'no_build'].includes(
                        receipt?.reconciliation?.decision ?? '',
                      )
                    )
                  })
                : undefined
            }
            onPrepare={prepare}
          />
        )}
        {batch && !editing && (
          <Card
            title="当前批次"
            extra={
              latest ? (
                <Button onClick={() => setReview(latest.id)}>
                  {latest.run ? '查看执行详情' : '查看批次摘要'}
                </Button>
              ) : undefined
            }
          >
            <Space orientation="vertical" style={{ width: '100%' }}>
              <Typography.Text>
                已选择 {batch.draft.length} 个渠道 · {new Date(batch.createdAt).toLocaleString()}
              </Typography.Text>
              {latest ? (
                <Space wrap>
                  {latest.targets.map((t) => (
                    <Tag key={t.id}>
                      {channelLabel(t.input.bindingId)} · {batchStatusLabels[t.status]}
                    </Tag>
                  ))}
                </Space>
              ) : (
                <Typography.Text type="secondary">草稿已保存，尚未准备。</Typography.Text>
              )}
              {latest?.run && !latest.run.finishedAt && (
                <Button
                  danger
                  onClick={() => void data.stop(batch, latest.run?.id ?? '')}
                  disabled={data.busy || !!latest.run.stoppedAt}
                >
                  停止后续执行
                </Button>
              )}
              {!active && (
                <Button
                  onClick={() => {
                    opening.current = ''
                    setEditing(true)
                  }}
                  disabled={data.busy}
                >
                  {latest?.run ? '重新准备剩余项' : '修正或重新准备'}
                </Button>
              )}
              {!latest && (
                <Button
                  type="primary"
                  onClick={() => {
                    opening.current = batch.id
                    void data.prepare(batch)
                  }}
                  disabled={data.busy}
                >
                  准备批次
                </Button>
              )}
              {latest?.run && (
                <Typography.Text type="secondary">
                  补发时只勾选允许的剩余项。成功的同一产物不重发，未知项需先在执行详情记录核对结论。
                </Typography.Text>
              )}
            </Space>
          </Card>
        )}
        <BatchHistory
          bindings={data.bindings}
          batches={data.batches}
          loading={data.loading}
          onSelect={(b) => {
            updateUrlState({ batch: b.id })
            setEditing(false)
            setReview(b.revisions.at(-1)?.id ?? '')
          }}
        />
        {batch && batch.revisions.length > 1 && (
          <Space wrap aria-label="批次版本历史">
            {batch.revisions.map((r, i) => (
              <Button key={r.id} onClick={() => setReview(r.id)}>
                第 {i + 1} 次摘要
              </Button>
            ))}
          </Space>
        )}
      </Flex>
      <BatchReview
        batch={batch}
        revision={revision}
        plans={data.plans}
        attempts={data.attempts}
        bindings={data.bindings}
        open={!!revision}
        busy={data.busy}
        error={data.error}
        onClose={() => setReview('')}
        onConfirm={async () => {
          if (batch && revision?.digest) await data.confirm(batch, revision.id, revision.digest)
        }}
        onStop={async () => {
          if (batch && revision?.run) await data.stop(batch, revision.run.id)
        }}
        onAttempt={(id) => {
          setReview('')
          setSelectedAttempt(id)
        }}
      />
      <AttemptReview
        attempt={attempt}
        plan={data.plans.find((p) => p.id === attempt?.planId)}
        disabled={data.busy}
        error={localError}
        onClose={() => setSelectedAttempt('')}
        onSave={async (receipt, input) => {
          setLocalError('')
          try {
            const c = new AbortController()
            const saved = await reconcileReleaseAttempt(
              application.projectId,
              application.id,
              receipt.id,
              input,
              c.signal,
            )
            data.refresh()
            return saved
          } catch (e) {
            setLocalError(e instanceof Error ? e.message : '核对未保存')
            return null
          }
        }}
      />
    </section>
  )
}
