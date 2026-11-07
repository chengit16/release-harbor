/** @description 用户启用的只读调度；观察结果、任务状态与通知同文件提交，无发布写许可。 */
import { digest } from './local-files.ts'
import { randomUUID } from 'node:crypto'
import { DomainError } from '@release-harbor/domain'
import {
  isRecord,
  hasExactKeys,
  isStoreVersionQuery,
  storeVersionStates,
  type LocalFollow,
  type LocalNotice,
  type LocalEfficiencyState,
  type StoreVersionStatus,
} from '@release-harbor/contracts'
import type { StoreStatusService } from './store-status.service.ts'
import { LocalStateStore } from './local-state-store.ts'
import { LocalMaintenance } from './local-maintenance.ts'

/** 有界事件登记，稳定键在重启或重复查询后仍去重。 */
export function addLocalNotice(
  state: LocalEfficiencyState,
  eventKey: string,
  title: string,
  detail: string,
  follow?: LocalFollow,
  now = Date.now(),
): void {
  if (state.notices.some((n) => n.eventKey === digest(eventKey))) return
  const n: LocalNotice = {
    id: randomUUID(),
    eventKey: digest(eventKey),
    title,
    detail,
    createdAt: new Date(now).toISOString(),
    read: false,
    projectId: follow?.projectId ?? null,
    applicationId: follow?.applicationId ?? null,
    bindingId: follow?.bindingId ?? null,
  }
  state.notices.unshift(n)
  state.notices = state.notices.slice(0, 300)
}
function versionKey(v: StoreVersionStatus, channel: string): string | null {
  // 无版本身份的官方结果只在明确范围内比较，绝不关联某个新包。
  if (channel === 'xiaomi' && v.state === 'published' && v.versionName)
    return `public:${v.versionName}`
  if (channel === 'tencent' && !v.versionId && !v.versionName && !v.buildNumber)
    return 'application-review'
  return v.versionId
    ? `id:${v.versionId}`
    : v.buildNumber
      ? `build:${v.versionName ?? ''}:${v.buildNumber}`
      : null
}
/** 固定目标、有限退避、服务运行期间调度；测试可注入时钟和渠道冷却。 */
export class LocalTrackingService {
  private busy = false
  constructor(
    private readonly store: LocalStateStore,
    private readonly status: StoreStatusService,
    private readonly maintenance: LocalMaintenance,
    private readonly now: () => number = Date.now,
  ) {}
  /** 校验用户选择，目标与账号版本由可信目录计算，浏览器不能声明指纹。 */
  async start(input: unknown): Promise<LocalFollow> {
    if (
      !isRecord(input) ||
      !hasExactKeys(input, [
        'projectId',
        'applicationId',
        'bindingId',
        'versionId',
        'buildNumber',
        'intervalMinutes',
        'until',
      ]) ||
      !(
        input.intervalMinutes === 15 ||
        input.intervalMinutes === 30 ||
        input.intervalMinutes === 60
      ) ||
      !['review', 'published'].includes(String(input.until)) ||
      [input.versionId, input.buildNumber].some(
        (v) => v !== null && (typeof v !== 'string' || !v.length || v.length > 120),
      )
    )
      throw new DomainError('跟踪设置格式不正确', 400)
    // 1. 从可信绑定及官方缓存恢复查询范围，页面不能自报版本归属。
    const directory = await this.status.list()
    const t = directory.targets.find(
      (t) =>
        t.projectId === input.projectId &&
        t.applicationId === input.applicationId &&
        t.bindingId === input.bindingId,
    )
    if (!t?.querySupported) throw new DomainError('商店目标不存在或不支持查询', 409)
    if (input.buildNumber && t.channel !== 'oppo')
      throw new DomainError('仅 OPPO 支持指定构建查询；其他渠道请选择官方版本 ID', 400)
    if (
      input.buildNumber &&
      (input.versionId ||
        !isStoreVersionQuery({ kind: 'oppo_build', buildNumber: input.buildNumber }))
    )
      throw new DomainError('请选择官方版本 ID 或填写有效 OPPO 构建号，不可同时指定', 400)
    if (
      input.versionId &&
      ![...directory.snapshots, ...(directory.trackedSnapshots ?? [])].some(
        (s) =>
          s.bindingId === t.bindingId &&
          s.code === 'observed' &&
          s.versions.some((v) => v.versionId === input.versionId),
      )
    )
      throw new DomainError('请先查询并选择官方目录中的版本', 409)
    // 2. 固定账号与目标指纹，后续变化必须暂停而非偷换任务。
    const fingerprint = await this.status.trackingFingerprint(
      t.projectId,
      t.applicationId,
      t.bindingId,
    )
    const now = this.now()
    const f: LocalFollow = {
      id: randomUUID(),
      projectId: t.projectId,
      applicationId: t.applicationId,
      bindingId: t.bindingId,
      label: `${t.applicationName} · ${t.channel}`,
      fingerprint,
      versionId: typeof input.versionId === 'string' ? input.versionId : null,
      buildNumber: typeof input.buildNumber === 'string' ? input.buildNumber : null,
      intervalMinutes: input.intervalMinutes === 15 ? 15 : input.intervalMinutes === 60 ? 60 : 30,
      until: input.until === 'published' ? 'published' : 'review',
      status: 'active',
      reason:
        t.channel === 'xiaomi'
          ? '仅观察公开在架，不查询审核进度'
          : !input.versionId && !input.buildNumber
            ? '应用级观察，不能证明某个新版本的审核结果'
            : '等待首次查询',
      nextAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 7 * 86400000).toISOString(),
      lastAt: null,
      failures: 0,
      baseline: {},
    }
    // 3. 任务持久化后才可由独立调度派发，重复目标保持唯一。
    return this.store.change((s) => {
      if (s.follows.filter((f) => f.status !== 'ended').length >= 100)
        throw new DomainError('最多保留一百项跟踪，请先结束旧任务', 409)
      if (
        s.follows.some(
          (p) =>
            p.status !== 'ended' &&
            p.bindingId === f.bindingId &&
            p.versionId === f.versionId &&
            p.buildNumber === f.buildNumber,
        )
      )
        throw new DomainError('此目标已有跟踪，请在原任务中继续或结束', 409)
      s.follows = s.follows.filter((f) => f.status !== 'ended').slice(0, 99)
      s.follows.unshift(f)
      return f
    })
  }
  /** 继续时重新核对绑定及账号目录，不能把变更后的目标静默替换进旧任务。 */
  async control(id: string, action: unknown): Promise<void> {
    if (!['pause', 'resume', 'end'].includes(String(action)))
      throw new DomainError('跟踪操作无效', 400)
    const old = (await this.store.read()).follows.find((f) => f.id === id)
    if (!old) throw new DomainError('跟踪不存在', 404)
    if (
      action === 'resume' &&
      (await this.status.trackingFingerprint(old.projectId, old.applicationId, old.bindingId)) !==
        old.fingerprint
    )
      throw new DomainError('绑定或账号已变化，请结束旧任务并重新开启跟踪', 409)
    await this.store.change((s) => {
      const f = s.follows.find((f) => f.id === id)
      if (!f) throw new DomainError('跟踪不存在', 404)
      f.status = action === 'end' ? 'ended' : action === 'resume' ? 'active' : 'paused'
      f.reason = action === 'resume' ? '用户继续跟踪' : '用户暂停或结束'
      if (action === 'resume' && Object.values(f.baseline).includes('pending_manual_release'))
        f.until = 'published'
      if (action === 'resume') {
        f.expiresAt = new Date(this.now() + 7 * 86400000).toISOString()
        f.nextAt = new Date(this.now()).toISOString()
        f.failures = 0
      }
    })
  }
  /** 每轮只派发一个到期目标；手动查询共用服务预约，重启不补跑所有错过轮次。
   * 长函数保留原因：任务领取、查询后指纹复核及原子事件登记需在同一维护资格内闭合。
   */
  async tick(): Promise<void> {
    if (this.busy || this.maintenance.locked || this.maintenance.restarting) return
    this.busy = true
    try {
      await this.maintenance.task(async () => {
        // 1. 每轮只领取一个到期任务，先校验期限、绑定及账号目录。
        const state = await this.store.read(),
          now = this.now()
        const f = state.follows.find((f) => f.status === 'active' && Date.parse(f.nextAt) <= now)
        if (!f) return
        if (Date.parse(f.expiresAt) <= now) {
          await this.pause(f, '跟踪已到期')
          return
        }
        let fingerprint: string
        try {
          fingerprint = await this.status.trackingFingerprint(
            f.projectId,
            f.applicationId,
            f.bindingId,
          )
        } catch {
          await this.pause(f, '目标或账号目录不可用')
          return
        }
        if (fingerprint !== f.fingerprint) {
          await this.pause(f, '绑定或账号已变化，请重新核对目标')
          return
        }
        try {
          // 2. 与手动入口共用固定只读查询、预约及全局并发。
          const snapshot = await this.status.query(
            f.projectId,
            f.applicationId,
            f.bindingId,
            f.buildNumber ? { kind: 'oppo_build', buildNumber: f.buildNumber } : undefined,
          )
          if (
            (await this.status.trackingFingerprint(f.projectId, f.applicationId, f.bindingId)) !==
            f.fingerprint
          ) {
            await this.pause(f, '查询期间账号或目标变化，结果不用于任务')
            return
          }
          await this.store.change((s) => {
            const current = s.follows.find((p) => p.id === f.id)
            if (!current || current.status !== 'active') return
            current.lastAt = snapshot.checkedAt
            current.nextAt = new Date(now + current.intervalMinutes * 60000).toISOString()
            if (snapshot.code !== 'observed') {
              this.failure(
                s,
                current,
                snapshot.code === 'network' ? '暂时无法连接商店' : '商店查询需处理',
                snapshot.code === 'network',
                now,
              )
              return
            }
            current.failures = 0
            const matches = snapshot.versions.filter(
              (v) =>
                (!f.versionId || v.versionId === f.versionId) &&
                (!f.buildNumber || v.buildNumber === f.buildNumber),
            )
            if ((f.versionId || f.buildNumber) && matches.length !== 1) {
              current.status = 'paused'
              current.reason = '响应未唯一包含所选版本，请核对商店'
              addLocalNotice(
                s,
                `${f.id}:target:${now}`,
                '跟踪目标需核对',
                current.reason,
                current,
                now,
              )
              return
            }
            // 3. 同范围比较并原子登记通知；目录缺项保留基线，不推断下架。
            const seen = new Set<string>()
            const next: Record<string, string> = { ...current.baseline }
            for (const v of matches) {
              const key = versionKey(v, snapshot.channel)
              if (
                !key ||
                seen.has(key) ||
                matches.filter((x) => versionKey(x, snapshot.channel) === key).length !== 1
              )
                continue
              seen.add(key)
              if (v.state !== 'unknown') next[key] = v.state
              const before = current.baseline[key]
              if (
                (v.state !== 'unknown' && before && before !== v.state) ||
                (!before &&
                  snapshot.channel === 'xiaomi' &&
                  Object.keys(current.baseline).length > 0 &&
                  v.state === 'published') ||
                (!before &&
                  [
                    'rejected',
                    'pre_rejected',
                    'qualification_rejected',
                    'pending_manual_release',
                  ].includes(v.state))
              ) {
                const first = !before && snapshot.channel !== 'xiaomi'
                addLocalNotice(
                  s,
                  `${f.id}:${key}:${snapshot.checkedAt}:${v.state}`,
                  first ? '首次发现待处理事项' : '商店状态发生变化',
                  `${current.label}：${snapshot.channel === 'tencent' && key === 'application-review' ? '应用级审核，未关联确定版本' : snapshot.channel === 'xiaomi' ? `公开在架 ${v.versionName}，不含审核进度` : (v.versionName ?? '版本未提供')} · ${storeVersionStates[v.state]}（观察时间，非实时）`,
                  current,
                  now,
                )
              }
            }
            current.baseline = Object.fromEntries(Object.entries(next).slice(-200))
            current.reason = '查询成功，等待下次查询（非实时）'
            // 应用级目录存在旧在架版本，不允许结束某个新版本的审核跟踪。
            if (f.versionId || f.buildNumber) {
              const v = matches[0]
              if (
                (v &&
                  [
                    'rejected',
                    'pre_rejected',
                    'qualification_rejected',
                    'withdrawn',
                    'published',
                  ].includes(v.state)) ||
                (v && f.until === 'review' && v.state === 'approved')
              )
                current.status = 'ended'
              if (v?.state === 'pending_manual_release') {
                current.status = 'paused'
                current.reason = '等待手动发布；可选择继续观察上架'
              }
            }
          })
        } catch (error) {
          await this.store.change((s) => {
            const c = s.follows.find((p) => p.id === f.id)
            if (!c || c.status !== 'active') return
            if (
              error instanceof DomainError &&
              (error.statusCode === 429 ||
                (error.statusCode === 409 && /冷却|正在查询|正在维护/.test(error.message)))
            ) {
              c.nextAt = new Date(now + Math.max(c.intervalMinutes * 60000, 10800000)).toISOString()
              c.reason = '等待渠道冷却'
              return
            }
            this.failure(s, c, '查询未完成，请检查目标与本机服务', false, now)
          })
        }
      })
    } finally {
      this.busy = false
    }
  }
  private failure(
    s: LocalEfficiencyState,
    f: LocalFollow,
    reason: string,
    retry: boolean,
    now: number,
  ): void {
    f.failures++
    f.reason = reason
    f.nextAt = new Date(
      now + Math.max(f.intervalMinutes * 60000, Math.min(6 * 3600000, f.failures * 3600000)),
    ).toISOString()
    if (!retry || f.failures >= 3) {
      f.status = 'paused'
      addLocalNotice(s, `${f.id}:failure:${now}`, '审核跟踪已暂停', reason, f, now)
    }
  }
  private async pause(f: LocalFollow, reason: string): Promise<void> {
    await this.store.change((s) => {
      const c = s.follows.find((x) => x.id === f.id)
      if (c?.status === 'active') {
        c.status = 'paused'
        c.reason = reason
        addLocalNotice(s, `${f.id}:pause:${this.now()}`, '审核跟踪需处理', reason, c, this.now())
      }
    })
  }
}
