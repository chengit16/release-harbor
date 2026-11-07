/** @description 本机增强验收；临时目录、合成账号、可控时钟与替身网络，不接触真实商店。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile, mkdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ProjectCatalog, ApplicationCatalog } from '../packages/domain/src/index.ts'
import type { StoreStatusSnapshot, ReleaseAttempt } from '../packages/contracts/src/index.ts'
import { FileProjectStore } from '../apps/api/src/project-store.ts'
import { FileApplicationStore } from '../apps/api/src/application-store.ts'
import { StoreStatusService } from '../apps/api/src/store-status.service.ts'
import { StoreStatusStore } from '../apps/api/src/store-status-store.ts'
import { LocalStateStore } from '../apps/api/src/local-state-store.ts'
import { LocalTrackingService } from '../apps/api/src/local-tracking.service.ts'
import { LocalMaintenance } from '../apps/api/src/local-maintenance.ts'
import { LocalBackupService, localDataRoot } from '../apps/api/src/local-backup.ts'
import { RecoverySafety } from '../apps/api/src/recovery-safety.ts'
import { LocalEfficiencyService } from '../apps/api/src/local-efficiency.service.ts'
import { FileReleasePlanStore } from '../apps/api/src/release-plan-store.ts'
import { atomicLocal } from '../apps/api/src/local-files.ts'
import { createApp } from '../apps/api/src/app.ts'
import { setup, confirmed } from './fixtures/release-plans.ts'

async function fixture(t: test.TestContext, channel: 'meizu' | 'xiaomi' | 'tencent' = 'meizu') {
  const root = await mkdtemp(join(tmpdir(), 'harbor-efficiency-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const { installation } = await localDataRoot(root)
  const projects = new FileProjectStore(join(root, 'projects.json'))
  const project = await new ProjectCatalog(projects).create('local', {
    name: '隔离项目',
    key: 'local',
    framework: 'native',
  })
  const apps = new FileApplicationStore(join(root, 'applications.json')),
    catalog = new ApplicationCatalog(projects, apps)
  const app = await catalog.create('local', project.id, {
    name: '合成应用',
    platform: 'android',
    identifier: 'com.example.local',
  })
  const binding = await catalog.bind('local', project.id, app.id, {
    channel,
    appId: channel === 'xiaomi' ? 'com.example.local' : '123456',
    credentialReference: 'synthetic-profile',
  })
  let calls = 0,
    now = Date.now(),
    state: StoreStatusSnapshot['code'] = 'observed',
    versionState: StoreStatusSnapshot['versions'][number]['state'] = 'in_review',
    publicVersion = '1.0',
    fingerprint = 'a'
  const cache = new StoreStatusStore(join(root, 'store-status.json'))
  const status = new StoreStatusService(
    projects,
    catalog,
    cache,
    {
      async run() {
        calls++
        return {
          bindingId: binding.id,
          channel,
          checkedAt: new Date(now).toISOString(),
          code: state,
          versions:
            state === 'observed'
              ? [
                  {
                    versionId: channel === 'meizu' ? '100' : null,
                    versionName:
                      channel === 'xiaomi' ? publicVersion : channel === 'meizu' ? '1.0' : null,
                    buildNumber: null,
                    state: channel === 'xiaomi' ? 'published' : versionState,
                    rawState: null,
                  },
                ]
              : [],
        }
      },
      close() {},
    },
    ['http://127.0.0.1:5178'],
    async () => fingerprint,
    () => now,
  )
  const store = new LocalStateStore(join(root, 'local-efficiency.json')),
    maintenance = new LocalMaintenance(),
    safety = new RecoverySafety(join(root, '.local', 'release-safety.json'))
  const tracking = new LocalTrackingService(store, status, maintenance, () => now),
    backups = new LocalBackupService(root, root, installation, safety)
  let restarted = false
  const service = new LocalEfficiencyService(
    backups,
    store,
    tracking,
    maintenance,
    safety,
    ['http://127.0.0.1:5178'],
    {
      pause: async () => {},
      resume: async () => {},
      catalog: async () => ({ code: 'available', accounts: [] }),
    },
    () => {
      restarted = true
    },
    () => now,
  )
  return {
    root,
    projects,
    project,
    apps,
    catalog,
    app,
    binding,
    status,
    cache,
    store,
    maintenance,
    safety,
    tracking,
    backups,
    service,
    calls: () => calls,
    advance: () => {
      now += 3 * 3600000
    },
    setCode: (s: typeof state) => {
      state = s
    },
    setState: (s: typeof versionState) => {
      versionState = s
    },
    setPublicVersion: (value: string) => {
      publicVersion = value
    },
    replaceProfile: () => {
      fingerprint = 'b'
    },
    restarted: () => restarted,
  }
}

test('业务白名单导出、恢复新数据代且不含秘密；坏包／任意路径／新格式拒绝', async (t) => {
  const f = await fixture(t)
  await mkdir(join(f.root, 'credentials'), { recursive: true })
  await writeFile(join(f.root, 'credentials', 'profiles.json'), 'DO-NOT-EXPORT')
  const backup = await f.service.backup(),
    raw = await f.backups.download(backup.id)
  assert.equal(raw.includes('DO-NOT-EXPORT'), false)
  const before = await readFile(join(f.root, 'projects.json'), 'utf8')
  for (const value of [
    '{',
    JSON.stringify({ schemaVersion: 99 }),
    raw.replace('projects.json', '../projects.json'),
    raw.replace('隔离项目', '损坏项目'),
  ])
    await assert.rejects(f.service.preview({ backup: value }))
  assert.equal(await readFile(join(f.root, 'projects.json'), 'utf8'), before)
  const preview = await f.service.preview({ backup: raw })
  await assert.rejects(f.service.restore({ id: preview.id, digest: 'wrong', acknowledged: true }))
  await f.service.restore({ id: preview.id, digest: preview.digest, acknowledged: true })
  assert.equal(f.maintenance.restarting, true)
  const selected = await localDataRoot(f.root)
  assert.notEqual(selected.data, f.root)
  assert.deepEqual(
    await new FileProjectStore(join(selected.data, 'projects.json')).list('local'),
    await f.projects.list('local'),
  )
  assert.equal(
    await readFile(join(f.root, 'credentials', 'profiles.json'), 'utf8'),
    'DO-NOT-EXPORT',
  )
  assert.equal(await f.safety.isReadOnly(), false)
})

test('预览之后当前业务变化拒绝覆盖；维护冲突、符号链接和账本缺失保持失败', async (t) => {
  const f = await fixture(t),
    b = await f.service.backup(),
    p = await f.service.preview({ backup: await f.backups.download(b.id) })
  await new ProjectCatalog(f.projects).create('local', {
    name: '新增',
    key: 'next',
    framework: 'native',
  })
  await assert.rejects(
    f.service.restore({ id: p.id, digest: p.digest, acknowledged: true }),
    /变化/,
  )
  f.maintenance.tasks++
  await assert.rejects(f.service.backup(), /活动/)
  f.maintenance.tasks--
  await rm(join(f.root, 'store-status.json'), { force: true })
  await symlink(join(f.root, 'projects.json'), join(f.root, 'store-status.json'))
  await assert.rejects(f.service.backup())
  await rm(join(f.root, '.local', 'release-safety.json'))
  await assert.rejects(f.safety.isReadOnly(), /缺失/)
})

test('早期安全账本缺少恢复时间时按未恢复读取，不改写其原字节', async (t) => {
  const f = await fixture(t),
    path = join(f.root, '.local', 'release-safety.json')
  const value = JSON.parse(await readFile(path, 'utf8'))
  delete value.restoredAt
  await writeFile(path, JSON.stringify(value))
  const before = await readFile(path, 'utf8')
  assert.equal(await f.safety.isReadOnly(), false)
  assert.equal(await readFile(path, 'utf8'), before)
})

test('跨安装恢复默认只读，恢复后跟踪暂停、自动备份关闭且不发通知', async (t) => {
  const f = await fixture(t)
  await f.tracking.start({
    projectId: f.project.id,
    applicationId: f.app.id,
    bindingId: f.binding.id,
    versionId: null,
    buildNumber: null,
    intervalMinutes: 30,
    until: 'review',
  })
  await f.store.change((s) => {
    s.autoBackup = true
  })
  const b = await f.backups.create(),
    raw = await f.backups.download(b.id)
  const foreign = JSON.parse(raw)
  foreign.installation = randomUUID()
  const p = await f.backups.preview(JSON.stringify(foreign))
  await f.backups.restore(p.id, p.digest)
  const { data } = await localDataRoot(f.root),
    settings = await new LocalStateStore(join(data, 'local-efficiency.json')).read()
  assert.equal(settings.autoBackup, false)
  assert.equal(settings.follows[0]?.status, 'paused')
  assert.equal(f.calls(), 0)
  assert.equal(await f.safety.isReadOnly(), true)
})

test('自动备份仅保留七份，手动不删；同周期不补跑、失败保留旧副本', async (t) => {
  const f = await fixture(t)
  await f.service.backup()
  for (let i = 0; i < 9; i++) await f.backups.create(true)
  assert.equal((await f.backups.list()).filter((b) => b.automatic).length, 7)
  assert.equal((await f.backups.list()).filter((b) => !b.automatic).length, 1)
  await f.store.change((s) => {
    s.autoBackup = true
    s.lastBackupAt = null
  })
  await f.service.tick()
  const count = (await f.backups.list()).length
  await f.service.tick()
  assert.equal((await f.backups.list()).length, count)
  await writeFile(join(f.root, 'projects.json'), '{')
  await assert.rejects(f.backups.create())
  assert.equal((await f.backups.list()).length, count)
})

test('无本机计划也可跟踪，首次基线不冒充变化、同范围变化仅通知一次', async (t) => {
  const f = await fixture(t)
  await f.status.query(f.project.id, f.app.id, f.binding.id)
  await f.tracking.start({
    projectId: f.project.id,
    applicationId: f.app.id,
    bindingId: f.binding.id,
    versionId: '100',
    buildNumber: null,
    intervalMinutes: 30,
    until: 'published',
  })
  // 现有缓存冷却未过，先安排到下一轮；控制时钟只影响调度，不绕过缓存预约。
  await rm(join(f.root, 'store-status.json'))
  f.advance()
  await f.tracking.tick()
  assert.equal((await f.store.read()).notices.length, 0)
  f.advance()
  f.setState('rejected')
  await rm(join(f.root, 'store-status.json'))
  await f.tracking.tick()
  const s = await f.store.read()
  assert.equal(s.notices.length, 1)
  assert.equal(s.follows[0]?.status, 'ended')
  await f.tracking.tick()
  assert.equal((await f.store.read()).notices.length, 1)
  assert.equal(await readFile(join(f.root, 'release-plans.json'), 'utf8').catch(() => null), null)
})

test('目录缺项不推断下架；账号变化暂停、网络三次失败暂停且不请求发布', async (t) => {
  const f = await fixture(t)
  const follow = await f.tracking.start({
    projectId: f.project.id,
    applicationId: f.app.id,
    bindingId: f.binding.id,
    versionId: null,
    buildNumber: null,
    intervalMinutes: 15,
    until: 'review',
  })
  f.setCode('network')
  for (let i = 0; i < 3; i++) {
    f.advance()
    await rm(join(f.root, 'store-status.json'), { force: true })
    await f.tracking.tick()
  }
  assert.equal((await f.store.read()).follows[0]?.status, 'paused')
  assert.equal((await f.store.read()).notices.length, 1)
  await f.tracking.control(follow.id, 'resume')
  f.replaceProfile()
  await f.tracking.tick()
  assert.equal((await f.store.read()).follows[0]?.status, 'paused')
  assert.equal(f.calls(), 3)
  await assert.rejects(f.tracking.control(follow.id, 'resume'), /变化/)
})

test('无版本 ID 的小米公开在架与应用宝审核按各自范围跟踪，不关联新包', async (t) => {
  const xiaomi = await fixture(t, 'xiaomi')
  await xiaomi.tracking.start({
    projectId: xiaomi.project.id,
    applicationId: xiaomi.app.id,
    bindingId: xiaomi.binding.id,
    versionId: null,
    buildNumber: null,
    intervalMinutes: 15,
    until: 'published',
  })
  await xiaomi.tracking.tick()
  xiaomi.advance()
  xiaomi.setPublicVersion('1.1')
  await rm(join(xiaomi.root, 'store-status.json'), { force: true })
  await xiaomi.tracking.tick()
  const xiaomiNotices = (await xiaomi.store.read()).notices
  assert.equal(xiaomiNotices.length, 1)
  assert.match(xiaomiNotices[0]?.detail ?? '', /公开在架 1.1，不含审核进度/)

  const tencent = await fixture(t, 'tencent')
  await tencent.tracking.start({
    projectId: tencent.project.id,
    applicationId: tencent.app.id,
    bindingId: tencent.binding.id,
    versionId: null,
    buildNumber: null,
    intervalMinutes: 15,
    until: 'review',
  })
  await tencent.tracking.tick()
  tencent.advance()
  tencent.setState('rejected')
  await rm(join(tencent.root, 'store-status.json'), { force: true })
  await tencent.tracking.tick()
  const tencentNotice = (await tencent.store.read()).notices[0]
  assert.match(tencentNotice?.detail ?? '', /应用级审核，未关联确定版本/)
  assert.equal((await tencent.store.read()).follows[0]?.status, 'active')
})

test('本机来源、严格字段、只读 GET 和维护保护；普通页面不改变任务状态', async (t) => {
  const f = await fixture(t),
    api = await createApp(f.projects, {
      applicationStore: f.apps,
      storeStatus: f.status,
      localEfficiency: f.service,
    })
  t.after(() => api.close())
  const headers = {
    host: '127.0.0.1',
    origin: 'http://127.0.0.1:5178',
    'x-release-harbor-local': '1',
  }
  assert.equal((await api.inject({ url: '/api/local', headers })).statusCode, 200)
  assert.equal(f.calls(), 0)
  assert.equal(
    (
      await api.inject({
        method: 'POST',
        url: '/api/local/backups',
        headers: { host: '127.0.0.1' },
        payload: {},
      })
    ).statusCode,
    403,
  )
  assert.equal(
    (
      await api.inject({
        method: 'POST',
        url: '/api/local/settings',
        headers,
        payload: {
          autoBackup: true,
          browserNotifications: false,
          showApplicationName: false,
          path: '/tmp',
        },
      })
    ).statusCode,
    400,
  )
  const b = await api.inject({ method: 'POST', url: '/api/local/backups', headers, payload: {} })
  assert.equal(b.statusCode, 201, b.body)
  // 导入允许有界备份大于普通 API 的 512 KiB，不能被 Nest 自定义配置误当正文上限。
  const bundle = JSON.parse(await f.backups.download(b.json().backup.id))
  const projects = bundle.files.find((entry: { name: string }) => entry.name === 'projects.json')
  const rows = JSON.parse(projects.data)
  rows[0].description = '合成资料'.repeat(100000)
  projects.data = JSON.stringify(rows)
  projects.sha256 = (await import('../apps/api/src/local-files.ts')).digest(projects.data)
  const large = await api.inject({
    method: 'POST',
    url: '/api/local/restore-preview',
    headers,
    payload: { backup: JSON.stringify(bundle) },
  })
  assert.equal(large.statusCode, 201, large.body)
  f.maintenance.locked = true
  assert.equal((await api.inject({ url: '/api/projects', headers })).statusCode, 409)
  f.maintenance.locked = false
})

test('恢复屏障拒绝旧许可和旧预检，新计划也不能重发账本已受理版本', async (t) => {
  const f = await setup(t, 'android'),
    p = await confirmed(f)
  await localDataRoot(f.root)
  const safety = new RecoverySafety(join(f.root, '.local', 'release-safety.json'))
  const a: ReleaseAttempt = {
    id: randomUUID(),
    planId: p.id,
    planDigest: p.digest,
    authorizationId: p.authorization?.id ?? '',
    status: 'running',
    code: 'running',
    createdAt: p.createdAt,
    remoteStartedAt: p.createdAt,
    finishedAt: null,
  }
  await safety.protect([p], [a], [], [], [])
  await safety.retire([p], [], false)
  const store = new FileReleasePlanStore(join(f.root, 'release-plans.json'), safety)
  await assert.rejects(
    store.execution(async (_p, attempts) => {
      attempts.push(a)
    }),
    /旧计划/,
  )
  const next = structuredClone(p)
  next.id = randomUUID()
  const nextAttempt = { ...a, id: randomUUID(), planId: next.id }
  await assert.rejects(safety.protect([next], [nextAttempt], [], [], []), /旧计划|待核对/)
  // 保留原计划、回执和摘要字节，保护在独立账本实施。
  assert.equal((await store.list(...f.args))[0]?.digest, p.digest)
})
