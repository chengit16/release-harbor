/** @description 本机空间、模板和运行诊断用例；清理持有维护门禁，不调用商店或修改发布保护。 */
import { lstat, open, statfs } from 'node:fs/promises'
import { constants, type ReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { DomainError, type ApplicationCatalog, type ProjectStore } from '@release-harbor/domain'
import {
  artifactLimits,
  hasExactKeys,
  isRecord,
  isPlanId,
  isReleasePreset,
  type ReleasePreset,
  type ReusableEntry,
  type LocalStorageView,
  type RuntimeCheck,
} from '@release-harbor/contracts'
import { FileArtifactStore } from './artifact-store.ts'
import { FileReleasePlanStore } from './release-plan-store.ts'
import { LocalEfficiencyService } from './local-efficiency.service.ts'
import { ReleasePresetStore } from './release-preset-store.ts'

/** IDs 只定位受控记录，输入中禁止服务器路径；批量请求最多一百条。 */
export function maintenanceIds(body: unknown): string[] {
  if (
    !isRecord(body) ||
    !hasExactKeys(body, ['ids', 'acknowledged']) ||
    body.acknowledged !== true ||
    !Array.isArray(body.ids) ||
    body.ids.length < 1 ||
    body.ids.length > 100 ||
    !body.ids.every(isPlanId) ||
    new Set(body.ids).size !== body.ids.length
  )
    throw new DomainError('请选择一至一百条记录并明确确认清理', 400)
  return body.ids
}
/** 诊断工具由可信宿主固定注入；控制面不加载 SDK，不接收可执行命令。 */
export class LocalProductivityService {
  readonly presets: ReleasePresetStore
  constructor(
    private readonly projects: ProjectStore,
    private readonly catalog: ApplicationCatalog,
    private readonly artifacts: FileArtifactStore,
    private readonly plans: FileReleasePlanStore,
    private readonly local: LocalEfficiencyService,
    private readonly tools: () => Promise<RuntimeCheck[]> = async () => [],
  ) {
    this.presets = new ReleasePresetStore(join(local.backups.data, 'release-presets.json'))
  }
  /** 所有维护写操作复用本机严格来源校验。 */
  assertSource(origin: unknown, marker: unknown): void {
    this.local.assertSource(origin, marker)
  }
  /** 汇总实际文件占用和历史引用；不复查远端、不修改记录。 */
  async storage(): Promise<LocalStorageView> {
    // 1. 当前可信目录限定归属，历史仅用于引用提示，不重算发布或请求商店。
    const history = await this.plans.backupState()
    const rows: LocalStorageView['artifacts'] = []
    for (const p of await this.projects.list('local')) {
      for (const a of await this.catalog.list('local', p.id)) {
        for (const record of await this.artifacts.list('local', p.id, a.id)) {
          const info = await lstat(
            record.status === 'receiving'
              ? this.artifacts.paths(record).partial
              : this.artifacts.paths(record).payload,
          ).catch((e: unknown) => {
            if (isRecord(e) && e.code === 'ENOENT') return null
            throw e
          })
          if (info && (!info.isFile() || info.isSymbolicLink()))
            throw new DomainError('安装包字节不是安全普通文件', 503)
          rows.push({
            id: record.id,
            projectId: p.id,
            applicationId: a.id,
            applicationName: `${p.name} / ${a.name} · ${a.platform === 'android' ? 'Android' : a.platform === 'ios' ? 'iOS' : 'HarmonyOS'}`,
            fileName: record.fileName,
            version: record.identity
              ? `${record.identity.versionName} (${record.identity.buildNumber})`
              : '未取得版本',
            createdAt: record.createdAt,
            status: record.failureCode === 'removed' ? 'removed' : record.status,
            sizeBytes: info?.size ?? 0,
            references: history.plans.filter((q) => q.snapshot.artifact.id === record.id).length,
          })
        }
      }
    }
    // 2. 字节占用与磁盘可用空间分别统计，缺失原文件不伪装成可下载。
    const disk = await statfs(this.artifacts.storageRoot())
    return {
      artifacts: rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      usedBytes: rows.reduce((n, r) => n + r.sizeBytes, 0),
      budgetBytes: artifactLimits.storageBudgetBytes,
      availableBytes: disk.bavail * disk.bsize,
      backupBytes: (await this.local.backups.list()).reduce((n, b) => n + b.sizeBytes, 0),
    }
  }
  /** 独占期阻止准备／执行／恢复竞态，任何活动后台事实都拒绝清理。 */
  async cleanup(body: unknown): Promise<void> {
    const ids = maintenanceIds(body)
    await this.local.maintenance.exclusive(async () => {
      // 1. 发布、导入、预检与查询全部空闲才可回收；已冻结计划会因原文件缺失失效。
      await this.local.backups.assertIdle()
      const rows = (await this.storage()).artifacts
      if (ids.some((id) => !rows.some((r) => r.id === id)))
        throw new DomainError('部分安装包不存在，请刷新后重选', 404)
      // 2. 全量归属核对后再写清理事实；失败保留已完成事实，用户刷新可核对，不回滚伪造字节。
      for (const id of ids) {
        const row = rows.find((r) => r.id === id)
        if (!row) throw new DomainError('安装包不存在', 404)
        const record = (await this.artifacts.list('local', row.projectId, row.applicationId)).find(
          (r) => r.id === id,
        )
        if (!record) throw new DomainError('安装包不存在', 404)
        await this.artifacts.removePayload(record)
      }
    })
  }
  /** 受控普通文件下载前重新计算摘要；历史已清理记录不可下载。 */
  async download(
    projectId: string,
    applicationId: string,
    id: string,
  ): Promise<{ fileName: string; stream: ReadStream; size: number }> {
    // 1. 先核对完整归属，只打开受控目录内的普通文件。
    await this.catalog.get('local', projectId, applicationId)
    const record = (await this.artifacts.list('local', projectId, applicationId)).find(
      (r) => r.id === id,
    )
    if (!record || record.status !== 'ready')
      throw new DomainError('安装包原文件不可用，请重新导入', 409)
    const file = await open(
      this.artifacts.paths(record).payload,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    )
    try {
      const info = await file.stat()
      if (!info.isFile() || info.size !== record.sizeBytes)
        throw new DomainError('安装包文件已变化', 409)
      // 2. 同一打开句柄校验实际摘要，校验失败关闭句柄，不返回不可信字节。
      const hash = createHash('sha256')
      for await (const chunk of file.createReadStream({ autoClose: false })) hash.update(chunk)
      if (hash.digest('hex') !== record.sha256)
        throw new DomainError('安装包摘要已变化，拒绝下载', 409)
      // 3. 下载流负责关闭句柄；请求生命周期阻止维护并发清理。
      return {
        fileName: record.fileName,
        stream: file.createReadStream({ start: 0, autoClose: true }),
        size: info.size,
      }
    } catch (error) {
      await file.close()
      throw error
    }
  }
  /** 用户确认后删除受控备份；不影响活动业务数据或外部下载。 */
  async removeBackups(body: unknown): Promise<void> {
    const ids = maintenanceIds(body)
    await this.local.maintenance.exclusive(() => this.local.backups.remove(ids))
  }
  /** 历史配置投影无产物、账号、时间或授权；模板按应用归属隔离。 */
  async reuse(projectId: string, applicationId: string): Promise<ReleasePreset[]> {
    await this.catalog.get('local', projectId, applicationId)
    // 1. 读取历史的安全配置投影，不携带产物、账号或授权。
    const state = await this.plans.backupState()
    const entry = (
      bindingId: string,
      releaseNotes: string,
      mode: ReusableEntry['mode'],
      submit = false,
    ): ReusableEntry => ({
      bindingId,
      releaseNotes,
      mode,
      huaweiAction: submit ? 'submit_review' : 'save_draft',
    })
    // 2. 批次子计划不重复当作单渠道模板来源。
    const batchPlanIds = new Set(
      state.batches.flatMap((b) => b.revisions.flatMap((r) => r.targets.map((t) => t.planId))),
    )
    const history: ReleasePreset[] = state.plans
      .filter(
        (p) =>
          p.snapshot.application.projectId === projectId &&
          p.snapshot.application.id === applicationId &&
          !batchPlanIds.has(p.id),
      )
      .slice(-20)
      .reverse()
      .map((p) => ({
        id: p.id,
        projectId,
        applicationId,
        name: `上次单渠道配置 · ${new Date(p.createdAt).toLocaleString('zh-CN')}`,
        kind: 'single',
        source: 'history',
        createdAt: p.createdAt,
        entries: [
          entry(
            p.snapshot.binding.id,
            p.snapshot.releaseNotes,
            p.snapshot.releasePolicy?.mode ?? 'after_approval',
            p.snapshot.action === 'huawei_submit_review',
          ),
        ],
      }))
    for (const b of state.batches
      .filter((b) => b.projectId === projectId && b.applicationId === applicationId)
      .slice(-20))
      history.push({
        id: b.id,
        projectId,
        applicationId,
        name: `批次配置 · ${new Date(b.createdAt).toLocaleString('zh-CN')}`,
        kind: 'batch',
        source: 'history',
        createdAt: b.createdAt,
        entries: b.draft.map((t) =>
          entry(t.bindingId, t.releaseNotes, t.releasePolicy?.mode ?? 'after_approval'),
        ),
      })
    // 3. 用户模板与历史合并后仍经过公开合同校验。
    return [
      ...(await this.presets.list()).filter(
        (p) => p.projectId === projectId && p.applicationId === applicationId,
      ),
      ...history,
    ].filter(isReleasePreset)
  }
  /** 只允许当前绑定与平台适用模式，保存配置不会准备或授权发布。 */
  async savePreset(projectId: string, applicationId: string, body: unknown): Promise<void> {
    // 1. 精确字段校验，禁止快照、秘密和旧授权混入模板。
    const app = await this.catalog.get('local', projectId, applicationId)
    const candidate = isRecord(body)
      ? {
          ...body,
          projectId,
          applicationId,
          id: '00000000-0000-4000-8000-000000000000',
          source: 'template',
          createdAt: new Date().toISOString(),
        }
      : null
    if (
      !isRecord(body) ||
      !hasExactKeys(body, ['name', 'kind', 'entries']) ||
      !isReleasePreset(candidate)
    )
      throw new DomainError('模板格式无效', 400)
    // 2. 模式与当前应用平台、绑定一致；模板不是绕过渠道校验的入口。
    const bindings = await this.catalog.bindings('local', projectId, applicationId)
    if (
      (candidate.kind === 'batch' &&
        (app.platform !== 'android' ||
          candidate.entries.some((e) => e.mode === 'manual' || e.huaweiAction !== 'save_draft'))) ||
      candidate.entries.some(
        (e) =>
          !bindings.some((b) => b.id === e.bindingId) ||
          (app.platform !== 'ios' && e.mode === 'manual') ||
          (app.platform === 'ios' && e.mode === 'scheduled'),
      )
    )
      throw new DomainError('模板绑定或平台策略不适用，请重新选择', 409)
    // 3. 存储使用同一串行写队列，不按名称覆盖原模板。
    await this.presets.add({
      projectId,
      applicationId,
      name: candidate.name,
      kind: candidate.kind,
      entries: candidate.entries,
    })
  }
  /** 诊断仅检查本地运行事实；工具探测由可信 Node 边界负责，不验证商店权限。 */
  async diagnostics(): Promise<RuntimeCheck[]> {
    // 1. 安全本机记录描述服务与任务，不进行商店权限探测。
    const s = await this.local.view()
    const active = s.state.follows.filter((f) => f.status === 'active').length
    const checks: RuntimeCheck[] = [
      {
        key: 'api',
        label: '本机 API',
        state: 'ready',
        detail: '服务可响应；仅本机单进程运行，退出或休眠期间不执行自动任务。',
      },
      {
        key: 'maintenance',
        label: '维护与恢复',
        state: s.recoveryReadOnly ? 'attention' : 'ready',
        detail: s.recoveryReadOnly
          ? '跨安装恢复处于只读保护，请到备份与恢复核对。'
          : '当前数据代可读取；执行仍需重新准备与明确确认。',
      },
      {
        key: 'tracking',
        label: '审核跟踪',
        state: s.state.follows.some((f) => f.status === 'paused') ? 'attention' : 'ready',
        detail: `${active} 项跟踪中，${s.state.follows.filter((f) => f.status === 'paused').length} 项暂停。请到审核状态的跟踪任务查看具体原因。`,
      },
      {
        key: 'backup',
        label: '自动备份',
        state: s.state.backupError ? 'attention' : 'ready',
        detail:
          s.state.backupError ??
          (s.state.autoBackup
            ? `已开启，最近成功：${s.state.lastBackupAt ?? '尚无成功记录'}。同盘副本请定期另存。`
            : '尚未开启，可到备份与恢复开启每日备份。'),
      },
    ]
    // 2. 容量故障投影为具体检查失败，不能用零占用掩盖读取错误。
    try {
      const storage = await this.storage()
      checks.push({
        key: 'storage',
        label: '安装包容量',
        state: storage.usedBytes >= storage.budgetBytes * 0.8 ? 'attention' : 'ready',
        detail: `已用 ${(storage.usedBytes / 1024 / 1024).toFixed(1)} MiB，预算 2048 MiB；空间不足请到存储管理清理。`,
      })
    } catch {
      checks.push({
        key: 'storage',
        label: '安装包容量',
        state: 'unavailable',
        detail: '无法安全读取存储，请保留数据并检查磁盘和备份。',
      })
    }
    // 3. 固定工具探测只返回安全就绪摘要，失败不泄露原始路径或输出。
    try {
      checks.push(...(await this.tools()))
    } catch {
      checks.push({
        key: 'tools',
        label: '检查工具',
        state: 'unavailable',
        detail: '本机工具探测失败，未检查远端权限。',
      })
    }
    return checks
  }
}
