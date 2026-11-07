/** @description 白名单备份与整代恢复；秘密仍留原根目录，指针切换前不改动当前业务数据。 */
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { mkdir, readdir, rm, lstat, link } from 'node:fs/promises'
import { DomainError } from '@release-harbor/domain'
import {
  isCredentialAccounts,
  isRecord,
  hasExactKeys,
  isPlanId,
  isArtifactRecord,
  isLocalEfficiencyState,
  type LocalBackup,
  type RestorePreview,
} from '@release-harbor/contracts'
import { FileProjectStore } from './project-store.ts'
import { FileApplicationStore } from './application-store.ts'
import { FileReleasePlanStore } from './release-plan-store.ts'
import { FilePreflightStore } from './preflight-store.ts'
import { ReleaseObservationStore } from './release-observation-store.ts'
import { StoreStatusStore } from './store-status-store.ts'
import { RecoverySafety } from './recovery-safety.ts'
import { atomicLocal, digest, readLocal } from './local-files.ts'

const names = [
  'projects.json',
  'applications.json',
  'release-plans.json',
  'preflights.json',
  'release-observations.json',
  'store-status.json',
  'local-efficiency.json',
  'credential-metadata.json',
]
const artifactPath = /^artifacts\/[a-f0-9-]{36}\/record\.json$/
const limit = 32 * 1024 * 1024
interface Bundle {
  schemaVersion: 1
  installation: string
  createdAt: string
  automatic: boolean
  files: { name: string; data: string; sha256: string }[]
}
interface Installation {
  id: string
  restored: boolean
}
/** 启动时只选择已经完整校验的一代；未知或损坏指针拒绝回退到旧目录。 */
export async function localDataRoot(root: string): Promise<{ data: string; installation: string }> {
  const path = join(root, '.local', 'installation.json')
  const raw = await readLocal(path)
  if (raw === null) {
    if (
      (await readLocal(join(root, '.local', 'active.json'))) !== null ||
      (await readLocal(join(root, '.local', 'release-safety.json'))) !== null
    )
      throw new DomainError('安装标识缺失，请保持只读并恢复诊断', 503)
    await atomicLocal(join(root, '.local', 'active.json'), { generation: null })
    await atomicLocal(join(root, '.local', 'release-safety.json'), {
      schemaVersion: 1,
      plans: [],
      attempts: [],
      appleReviews: [],
      retired: [],
      readOnly: false,
      restoredAt: null,
    })
    await atomicLocal(path, { id: randomUUID(), restored: false })
  }
  const identity: unknown = JSON.parse((await readLocal(path)) ?? 'null')
  if (!isRecord(identity) || !isPlanId(identity.id) || typeof identity.restored !== 'boolean')
    throw new DomainError('本机安装标识损坏', 503)
  const pointer = await readLocal(join(root, '.local', 'active.json'))
  if (pointer === null) throw new DomainError('恢复指针缺失，禁止回退旧数据', 503)
  const v: unknown = JSON.parse(pointer)
  if (
    !isRecord(v) ||
    !hasExactKeys(v, ['generation']) ||
    (v.generation !== null && !isPlanId(v.generation))
  )
    throw new DomainError('恢复指针损坏', 503)
  if (v.generation === null) return { data: root, installation: identity.id }
  const data = join(root, '.local', 'generations', v.generation)
  const info = await lstat(data)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new DomainError('恢复数据代不存在', 503)
  return { data, installation: identity.id }
}
/** 固定根与数据代由启动边界指定，浏览器只能使用备份 ID。 */
export class LocalBackupService {
  private previews = new Map<
    string,
    { preview: RestorePreview; bundle: Bundle; currentDigest: string }
  >()
  constructor(
    readonly root: string,
    readonly data: string,
    private readonly installation: string,
    private readonly safety: RecoverySafety,
  ) {}
  private file(id: string): string {
    if (!isPlanId(id)) throw new DomainError('备份不存在', 404)
    return join(this.root, '.local', 'backups', id + '.json')
  }
  /** 校验业务结构及归属，暂存目录不包含可运行代码或秘密。 */
  async validate(directory: string): Promise<void> {
    // 1. 先校验项目及凭据安全元数据，未知字段不能随备份进入活动代。
    const projectRaw = await readLocal(join(directory, 'projects.json'))
    if (projectRaw !== null) {
      const rows: unknown = JSON.parse(projectRaw)
      if (
        !Array.isArray(rows) ||
        !rows.every(
          (p) =>
            isRecord(p) &&
            hasExactKeys(p, [
              'id',
              'workspaceId',
              'key',
              'name',
              'framework',
              'description',
              'createdAt',
            ]) &&
            isPlanId(p.id) &&
            p.workspaceId === 'local' &&
            typeof p.key === 'string' &&
            typeof p.name === 'string' &&
            ['react-native', 'flutter', 'native', 'other'].includes(String(p.framework)) &&
            typeof p.description === 'string' &&
            typeof p.createdAt === 'string' &&
            Number.isFinite(Date.parse(p.createdAt)),
        )
      )
        throw new DomainError('备份项目格式无效', 400)
    }
    const metadata = await readLocal(join(directory, 'credential-metadata.json'))
    if (metadata !== null && !isCredentialAccounts(JSON.parse(metadata)))
      throw new DomainError('账号元数据格式无效', 400)
    // 2. 所有领域存储复用现有合同守卫，并核对应用、计划、预检的跨模块归属。
    const projects = await new FileProjectStore(join(directory, 'projects.json')).list('local')
    const apps = await new FileApplicationStore(join(directory, 'applications.json')).backupState()
    const plans = await new FileReleasePlanStore(
      join(directory, 'release-plans.json'),
    ).backupState()
    const preflights = await new FilePreflightStore(
      join(directory, 'preflights.json'),
    ).backupState()
    await new ReleaseObservationStore(join(directory, 'release-observations.json')).backupState()
    await new StoreStatusStore(join(directory, 'store-status.json')).backupState()
    if (
      apps.applications.some(
        (a) => a.workspaceId !== 'local' || !projects.some((p) => p.id === a.projectId),
      )
    )
      throw new DomainError('备份应用归属无效', 400)
    const owned = (p: string, a: string) =>
      apps.applications.some((x) => x.id === a && x.projectId === p)
    if (
      plans.plans.some(
        (p) => !owned(p.snapshot.application.projectId, p.snapshot.application.id),
      ) ||
      plans.appleReviews.some(
        (p) => !owned(p.snapshot.binding.projectId, p.snapshot.binding.applicationId),
      ) ||
      preflights.some((p) => !owned(p.projectId, p.applicationId))
    )
      throw new DomainError('备份历史归属无效', 400)
    const settings = await readLocal(join(directory, 'local-efficiency.json'))
    if (settings !== null && !isLocalEfficiencyState(JSON.parse(settings)))
      throw new DomainError('备份设置格式无效', 400)
    // 3. 产物目录只接受固定 UUID 元数据文件，拒绝符号链接及不匹配的应用身份。
    const artifactRoot = await lstat(join(directory, 'artifacts')).catch((e: unknown) => {
      if (isRecord(e) && e.code === 'ENOENT') return null
      throw e
    })
    if (artifactRoot && (!artifactRoot.isDirectory() || artifactRoot.isSymbolicLink()))
      throw new DomainError('安装包根目录不安全', 400)
    for (const id of await readdir(join(directory, 'artifacts')).catch((e: unknown) => {
      if (isRecord(e) && e.code === 'ENOENT') return []
      throw e
    })) {
      if (!isPlanId(id)) throw new DomainError('安装包目录身份无效', 400)
      const info = await lstat(join(directory, 'artifacts', id))
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new DomainError('安装包目录不安全', 400)
      const value: unknown = JSON.parse(
        (await readLocal(join(directory, 'artifacts', id, 'record.json'), 16384)) ?? 'null',
      )
      if (
        !isRecord(value) ||
        value.schemaVersion !== 1 ||
        !isArtifactRecord(value.artifact) ||
        value.artifact.id !== id ||
        !owned(value.artifact.projectId, value.artifact.applicationId)
      )
        throw new DomainError('安装包元数据归属无效', 400)
    }
  }
  /** 维护门禁内收集，目录白名单不包含 credentials、Keychain 或安装包原文件。 */
  async collect(automatic = false): Promise<Bundle> {
    await this.validate(this.data)
    const files: Bundle['files'] = []
    for (const name of names) {
      const data = await readLocal(join(this.data, name))
      if (data !== null) files.push({ name, data, sha256: digest(data) })
    }
    for (const id of await readdir(join(this.data, 'artifacts')).catch((e: unknown) => {
      if (isRecord(e) && e.code === 'ENOENT') return []
      throw e
    })) {
      const name = `artifacts/${id}/record.json`
      const data = await readLocal(join(this.data, name), 16384)
      if (data !== null) files.push({ name, data, sha256: digest(data) })
    }
    const bundle: Bundle = {
      schemaVersion: 1,
      installation: this.installation,
      createdAt: new Date().toISOString(),
      automatic,
      files,
    }
    if (Buffer.byteLength(JSON.stringify(bundle)) > limit)
      throw new DomainError('业务数据超过首版 32 MiB 备份上限', 413)
    return bundle
  }
  /** 检查所有异步运行事实；HTTP 结束不等于后台任务结束。 */
  async assertIdle(): Promise<void> {
    const p = await new FileReleasePlanStore(join(this.data, 'release-plans.json')).backupState()
    const pf = await new FilePreflightStore(join(this.data, 'preflights.json')).backupState()
    const statuses = await new StoreStatusStore(join(this.data, 'store-status.json')).backupState()
    const active =
      p.attempts.some((a) => !a.finishedAt) ||
      p.appleReviews.some((r) => r.status === 'running') ||
      p.preparations.some((q) => q.status === 'checking') ||
      p.batches.some((b) =>
        b.revisions.some((r) => !r.preparedAt || (r.run && !r.run.finishedAt)),
      ) ||
      pf.some((r) => r.status === 'running') ||
      statuses.some((e) => e.pending && Date.now() - e.requestedAt < 180000)
    if (active) throw new DomainError('有发布、准备或查询进行中，请完成后重试', 409)
    const bundle = await this.collect()
    if (
      bundle.files.some(
        (f) => artifactPath.test(f.name) && /"status"\s*:\s*"(receiving|checking)"/.test(f.data),
      )
    )
      throw new DomainError('安装包正在导入，请稍后重试', 409)
  }
  private summary(id: string, b: Bundle, sizeBytes: number): LocalBackup {
    return { id, createdAt: b.createdAt, automatic: b.automatic, sizeBytes, files: b.files.length }
  }
  /** 备份先完整验证再发布；保留策略只删除成功的自动备份。 */
  async create(automatic = false): Promise<LocalBackup> {
    const b = await this.collect(automatic),
      id = randomUUID()
    await atomicLocal(this.file(id), b)
    const result = this.summary(id, b, Buffer.byteLength(JSON.stringify(b)))
    if (automatic)
      for (const item of (await this.list()).filter((x) => x.automatic).slice(7))
        await rm(this.file(item.id))
    return result
  }
  /** 目录损坏明确失败，不伪造空备份列表。 */
  async list(): Promise<LocalBackup[]> {
    const items: LocalBackup[] = []
    const entries = await readdir(join(this.root, '.local', 'backups')).catch((e: unknown) => {
      if (isRecord(e) && e.code === 'ENOENT') return []
      throw e
    })
    for (const file of entries) {
      if (!file.endsWith('.json')) continue
      const id = file.slice(0, -5),
        raw = await this.download(id),
        b = this.decode(raw)
      items.push(this.summary(id, b, Buffer.byteLength(raw)))
    }
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  /** 下载仅白名单备份容器，不开放任意文件读取。 */
  async download(id: string): Promise<string> {
    const raw = await readLocal(this.file(id), limit)
    if (raw === null) throw new DomainError('备份不存在', 404)
    this.decode(raw)
    return raw
  }
  private decode(raw: string): Bundle {
    try {
      if (Buffer.byteLength(raw) > limit) throw Error()
      const v: unknown = JSON.parse(raw)
      if (
        !isRecord(v) ||
        !hasExactKeys(v, ['schemaVersion', 'installation', 'createdAt', 'automatic', 'files']) ||
        v.schemaVersion !== 1 ||
        !isPlanId(v.installation) ||
        typeof v.createdAt !== 'string' ||
        new Date(v.createdAt).toISOString() !== v.createdAt ||
        typeof v.automatic !== 'boolean' ||
        !Array.isArray(v.files) ||
        v.files.length > 10000
      )
        throw Error()
      const files: Bundle['files'] = []
      for (const f of v.files) {
        if (
          !isRecord(f) ||
          !hasExactKeys(f, ['name', 'data', 'sha256']) ||
          typeof f.name !== 'string' ||
          (!names.includes(f.name) && !artifactPath.test(f.name)) ||
          typeof f.data !== 'string' ||
          f.sha256 !== digest(f.data) ||
          files.some((x) => x.name === f.name)
        )
          throw Error()
        JSON.parse(f.data)
        files.push({ name: f.name, data: f.data, sha256: f.sha256 })
      }
      return {
        schemaVersion: 1,
        installation: v.installation,
        createdAt: v.createdAt,
        automatic: v.automatic,
        files,
      }
    } catch {
      throw new DomainError('备份损坏、超限或格式不受支持，当前数据未改变', 400)
    }
  }
  private async stage(b: Bundle): Promise<string> {
    const dir = join(this.root, '.local', 'generations', randomUUID())
    await mkdir(dir, { recursive: true, mode: 0o700 })
    try {
      for (const f of b.files) await atomicLocal(join(dir, f.name), JSON.parse(f.data))
      await this.validate(dir)
      return dir
    } catch (error) {
      await rm(dir, { recursive: true, force: true })
      throw error
    }
  }
  /** 预览校验在隔离代进行；只保存十分钟、最多三个预览，不发送商店请求。 */
  async preview(raw: string): Promise<RestorePreview> {
    const b = this.decode(raw),
      stage = await this.stage(b)
    await rm(stage, { recursive: true, force: true })
    const current = await this.collect()
    const metadataFile = b.files.find((f) => f.name === 'credential-metadata.json')
    const metadata: unknown = metadataFile ? JSON.parse(metadataFile.data) : null
    const preview: RestorePreview = {
      id: randomUUID(),
      digest: digest(raw),
      createdAt: new Date().toISOString(),
      sourceCreatedAt: b.createdAt,
      currentFiles: current.files.length,
      restoredFiles: b.files.length,
      sameInstallation: b.installation === this.installation,
      artifactRecords: b.files.filter((f) => artifactPath.test(f.name)).length,
      credentialAccounts: isCredentialAccounts(metadata) ? metadata.accounts.length : 0,
    }
    if (this.previews.size >= 3) this.previews.delete(this.previews.keys().next().value ?? '')
    this.previews.set(preview.id, {
      preview,
      bundle: b,
      currentDigest: digest(JSON.stringify(current.files)),
    })
    return preview
  }
  /** 先保存当前代和保护屏障，再原子切换启动指针；由宿主关闭旧服务并重建依赖。 */
  async restore(id: string, expectedDigest: string): Promise<void> {
    // 1. 确认只消费服务端预览，旧数据变动后必须重新预览。
    const saved = this.previews.get(id)
    if (
      !saved ||
      saved.preview.digest !== expectedDigest ||
      Date.now() - Date.parse(saved.preview.createdAt) > 600000
    )
      throw new DomainError('恢复预览已失效，请重新选择备份', 409)
    const current = await this.collect()
    if (digest(JSON.stringify(current.files)) !== saved.currentDigest)
      throw new DomainError('当前数据已变化，请重新预览', 409)
    await this.create(false)
    const stage = await this.stage(saved.bundle)
    // 2. 不篡改原快照；退役旧许可，保留恢复之前和备份中的所有保护事实。
    const before = await new FileReleasePlanStore(
      join(this.data, 'release-plans.json'),
    ).backupState()
    const imported = await new FileReleasePlanStore(join(stage, 'release-plans.json')).backupState()
    await this.safety.protect(
      before.plans,
      before.attempts,
      before.appleReviews,
      before.attempts,
      before.appleReviews,
    )
    await this.safety.retire(
      [...before.plans, ...imported.plans],
      [...before.appleReviews, ...imported.appleReviews],
      !saved.preview.sameInstallation,
    )
    await this.safety.protect(
      imported.plans,
      imported.attempts,
      imported.appleReviews,
      imported.attempts,
      imported.appleReviews,
    )
    const settings = await readLocal(join(stage, 'local-efficiency.json'))
    if (settings) {
      const v: unknown = JSON.parse(settings)
      if (isLocalEfficiencyState(v)) {
        v.autoBackup = false
        // 导入的未读记录不能在仍打开的页面被当作新系统通知补发。
        v.browserNotifications = false
        v.follows.forEach((f) => {
          f.status = 'paused'
          f.reason = '恢复后请核对目标并显式继续'
        })
        await atomicLocal(join(stage, 'local-efficiency.json'), v)
      }
    }
    // 安装包不在备份中；同机仅复用同 ID 的已有普通字节，后续检查仍重验摘要。
    for (const f of saved.bundle.files.filter((f) => artifactPath.test(f.name))) {
      const v: unknown = JSON.parse(f.data)
      if (isRecord(v) && isArtifactRecord(v.artifact)) {
        const name = `artifacts/${v.artifact.id}/payload.${v.artifact.format}`
        const from = join(this.data, name),
          to = join(stage, name)
        const info = await lstat(from).catch(() => null)
        if (info?.isFile() && !info.isSymbolicLink()) await link(from, to)
      }
    }
    // 3. 指针替换是唯一提交点；失败保留旧代，启动只能选完整新代或原代。
    const identity: Installation = { id: this.installation, restored: true }
    await atomicLocal(join(this.root, '.local', 'installation.json'), identity)
    await atomicLocal(join(this.root, '.local', 'active.json'), {
      generation: stage.split('/').at(-1),
    })
    this.previews.clear()
  }
}
