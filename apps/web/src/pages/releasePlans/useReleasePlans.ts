/** @description 发布计划的数据读取与变更，组件内维护状态，卸载取消等待，失败先刷新事实而不重放写请求。 */
import { useEffect, useRef, useState } from 'react'
import type {
  ReleaseAttempt,
  Application,
  CreateReleasePlan,
  PreflightView,
  ReleasePlan,
  ReleasePlanView,
} from '@release-harbor/contracts'
import { listPreflights } from '../../api/services/preflights.ts'
import {
  executeReleasePlan,
  listReleaseAttempts,
  decideReleasePlan,
  freezeReleasePlan,
  listReleasePlans,
} from '../../api/services/releasePlans.ts'

/** 应用生命周期内读取计划和可用预检，30 秒刷新有效性不触发商店查询。 */
export function useReleasePlans(application: Application) {
  const [attempts, setAttempts] = useState<ReleaseAttempt[]>([])
  const [plans, setPlans] = useState<ReleasePlanView[]>([])
  const [preflights, setPreflights] = useState<PreflightView[]>([])
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
        const [receipts, saved, checks] = await Promise.all([
          listReleaseAttempts(application.projectId, application.id, controller.signal),
          listReleasePlans(application.projectId, application.id, controller.signal),
          listPreflights(application.projectId, application.id, controller.signal),
        ])
        if (controller.signal.aborted) return
        setAttempts(receipts)
        setPlans(saved)
        setPreflights(checks)
        timer = setTimeout(
          () => void load(),
          receipts.some((a) => a.finishedAt === null) ? 2000 : 30000,
        )
      } catch (failure) {
        if (!controller.signal.aborted) {
          setAttempts([])
          setPlans([])
          setPreflights([])
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
    execute: (plan: ReleasePlan) =>
      mutate(
        (signal) => executeReleasePlan(application.projectId, application.id, plan, signal),
        '本次授权已消费，请查看执行记录；关闭页面不会撤回远端操作',
      ),
    plans,
    preflights,
    loading,
    busy,
    error,
    notice,
    refresh: () => {
      setError('')
      setRevision((v) => v + 1)
    },
    freeze: (input: CreateReleasePlan) =>
      mutate(
        (signal) => freezeReleasePlan(application.projectId, application.id, input, signal),
        '计划已冻结，请核对完整快照后确认',
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
