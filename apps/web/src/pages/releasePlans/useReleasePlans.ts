/** @description 发布计划的数据读取与变更，组件内维护状态，卸载取消等待，失败先刷新事实而不重放写请求。 */
import { useEffect, useRef, useState } from 'react'
import type {
  ReconcileAttemptInput,
  ReleaseAttempt,
  Application,
  PrepareReleaseInput,
  ReleasePreparation,
  ArtifactRecord,
  ChannelBinding,
  ReleasePlan,
  ReleasePlanView,
} from '@release-harbor/contracts'
import { listReleaseBatches } from '../../api/services/releaseBatches.ts'
import { listArtifacts } from '../../api/services/artifacts.ts'
import { listBindings } from '../../api/services/applications.ts'
import {
  reconcileReleaseAttempt,
  executeReleasePlan,
  listReleaseAttempts,
  decideReleasePlan,
  prepareRelease,
  listReleasePreparations,
  listReleasePlans,
} from '../../api/services/releasePlans.ts'

/** 应用生命周期内读取计划和可用预检，30 秒刷新有效性不触发商店查询。 */
export function useReleasePlans(application: Application) {
  const [attempts, setAttempts] = useState<ReleaseAttempt[]>([])
  const [plans, setPlans] = useState<ReleasePlanView[]>([])
  const [preparations, setPreparations] = useState<ReleasePreparation[]>([])
  const [bindings, setBindings] = useState<ChannelBinding[]>([])
  const [artifacts, setArtifacts] = useState<ArtifactRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [revision, setRevision] = useState(0)
  const lifetime = useRef<AbortController | null>(null)
  const lock = useRef(false)
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    return () => controller.abort()
  }, [application.id])
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    setLoading(true)
    async function load(): Promise<void> {
      try {
        const [receipts, saved, prepared, channels, packages, batches] = await Promise.all([
          listReleaseAttempts(application.projectId, application.id, controller.signal),
          listReleasePlans(application.projectId, application.id, controller.signal),
          listReleasePreparations(application.projectId, application.id, controller.signal),
          listBindings(application.projectId, application.id, controller.signal),
          listArtifacts(application.projectId, application.id, controller.signal),
          listReleaseBatches(application.projectId, application.id, controller.signal),
        ])
        if (controller.signal.aborted) return
        setAttempts(receipts.filter((a) => !a.origin))
        // 批次子计划只有批次摘要可以确认，避免在旧入口展示独立执行按钮。
        const children = batches.flatMap((b) => b.revisions.flatMap((r) => r.targets))
        setPlans(saved.filter((v) => !children.some((t) => t.planId === v.plan.id)))
        setPreparations(prepared.filter((p) => !children.some((t) => t.preparationId === p.id)))
        setBindings(channels)
        setArtifacts(packages)
        timer = setTimeout(
          () => void load(),
          receipts.some((a) => a.finishedAt === null) ||
            prepared.some(
              (p) =>
                p.status === 'checking' ||
                (p.status === 'ready' && !saved.some((v) => v.plan.id === p.planId)),
            )
            ? 1000
            : 30000,
        )
      } catch (failure) {
        if (!controller.signal.aborted) {
          setAttempts([])
          setPlans([])
          setPreparations([])
          setBindings([])
          setArtifacts([])
          setError(failure instanceof Error ? failure.message : '计划读取失败')
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void load()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [application.id, application.projectId, revision])

  async function mutate<T>(
    action: (signal: AbortSignal) => Promise<T>,
    message: string,
  ): Promise<T | null> {
    const controller = lifetime.current
    if (lock.current || !controller || controller.signal.aborted) return null
    lock.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await action(controller.signal)
      if (controller.signal.aborted) return null
      setNotice(message)
      return result
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          (failure instanceof Error ? failure.message : '操作未完成') +
            '；请重新读取计划确认结果，系统不会自动重试。',
        )
      return null
    } finally {
      lock.current = false
      if (!controller.signal.aborted) {
        setBusy(false)
        setRevision((v) => v + 1)
      }
    }
  }
  return {
    attempts,
    reconcile: (attempt: ReleaseAttempt, input: ReconcileAttemptInput) =>
      mutate(
        (signal) =>
          reconcileReleaseAttempt(application.projectId, application.id, attempt.id, input, signal),
        '人工核对结论已记录；没有发起上传，旧授权不会恢复',
      ),
    execute: (plan: ReleasePlan) =>
      mutate(
        (signal) => executeReleasePlan(application.projectId, application.id, plan, signal),
        '执行请求已登记，请查看实际执行结果；登记不等于商店受理',
      ),
    plans,
    preparations,
    bindings,
    artifacts,
    loading,
    busy,
    error,
    notice,
    refresh: () => {
      setError('')
      setRevision((v) => v + 1)
    },
    prepare: (input: PrepareReleaseInput) =>
      mutate(
        (signal) => prepareRelease(application.projectId, application.id, input, signal),
        '发布准备已受理，请等待检查结果',
      ),
    decide: (plan: ReleasePlan, decision: 'confirm' | 'cancel') =>
      mutate(
        (signal) =>
          decideReleasePlan(application.projectId, application.id, plan, decision, signal),
        decision === 'confirm'
          ? '已记录本次限定确认；请在有效期内复核并执行'
          : '计划已取消，原确认已撤销',
      ),
  }
}
