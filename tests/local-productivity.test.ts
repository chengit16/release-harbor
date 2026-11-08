/** @description 空间管理与配置复用的跨层验收；只使用隔离目录与合成产物，不访问真实商店。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readFile, writeFile, lstat, symlink, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { setup } from './fixtures/release-plans.ts'
import { LocalProductivityService } from '../apps/api/src/local-productivity.service.ts'
import { localDataRoot, LocalBackupService } from '../apps/api/src/local-backup.ts'
import { LocalEfficiencyService } from '../apps/api/src/local-efficiency.service.ts'
import { LocalStateStore } from '../apps/api/src/local-state-store.ts'
import { LocalMaintenance } from '../apps/api/src/local-maintenance.ts'
import { LocalTrackingService } from '../apps/api/src/local-tracking.service.ts'
import { RecoverySafety } from '../apps/api/src/recovery-safety.ts'
import { StoreStatusService } from '../apps/api/src/store-status.service.ts'
import { StoreStatusStore } from '../apps/api/src/store-status-store.ts'
import { createApp } from '../apps/api/src/app.ts'

async function fixture(t: test.TestContext) {
  const f = await setup(t, 'android'),
    { installation } = await localDataRoot(f.root)
  const state = new LocalStateStore(join(f.root, 'local-efficiency.json')),
    maintenance = new LocalMaintenance(),
    safety = new RecoverySafety(join(f.root, '.local/release-safety.json'))
  let calls = 0
  const statuses = new StoreStatusService(
    f.projects,
    f.catalog,
    new StoreStatusStore(join(f.root, 'store-status.json')),
    {
      run: async () => {
        calls++
        throw Error('不应查询商店')
      },
      close() {},
    },
    ['http://127.0.0.1:5178'],
  )
  const local = new LocalEfficiencyService(
    new LocalBackupService(f.root, f.root, installation, safety),
    state,
    new LocalTrackingService(state, statuses, maintenance),
    maintenance,
    safety,
    ['http://127.0.0.1:5178'],
    {
      pause: async () => {},
      resume: async () => {},
      catalog: async () => ({ code: 'available', accounts: [] }),
    },
  )
  const service = new LocalProductivityService(
    f.projects,
    f.catalog,
    f.bytes,
    f.store,
    local,
    async () => [
      { key: 'synthetic-tools', label: '合成工具', state: 'ready', detail: '仅测试替身' },
    ],
  )
  return { ...f, local, service, maintenance, calls: () => calls }
}

test('清理回收实际字节，保留元数据和旧计划；无效批量及活动维护拒绝', async (t) => {
  const f = await fixture(t),
    p = await f.plans.freeze(...f.args, f.input)
  const before = await readFile(f.file, 'utf8'),
    path = f.bytes.paths(f.artifact).payload
  const view = await f.service.storage()
  assert.equal(view.usedBytes, f.artifact.sizeBytes)
  assert.equal(view.artifacts[0]?.references, 1)
  await assert.rejects(
    f.service.cleanup({ ids: [f.artifact.id, randomUUID()], acknowledged: true }),
  )
  assert.ok(await lstat(path))
  f.maintenance.tasks++
  await assert.rejects(f.service.cleanup({ ids: [f.artifact.id], acknowledged: true }), /活动/)
  f.maintenance.tasks--
  await f.service.cleanup({ ids: [f.artifact.id], acknowledged: true })
  await assert.rejects(lstat(path))
  assert.equal((await f.service.storage()).usedBytes, 0)
  assert.equal((await f.artifacts.get(...f.args, f.artifact.id)).failureCode, 'removed')
  assert.equal(await readFile(f.file, 'utf8'), before)
  assert.equal((await f.plans.list(...f.args)).find((v) => v.plan.id === p.id)?.current, false)
  await f.service.cleanup({ ids: [f.artifact.id], acknowledged: true })
  assert.equal(f.calls(), 0)
})

test('下载验证摘要与应用归属，损坏和符号链接拒绝', async (t) => {
  const f = await fixture(t)
  const output = await f.service.download(f.application.projectId, f.application.id, f.artifact.id)
  const chunks: Buffer[] = []
  for await (const chunk of output.stream) chunks.push(Buffer.from(chunk))
  assert.equal(Buffer.concat(chunks).toString(), 'isolated-synthetic-plan-bytes')
  await assert.rejects(f.service.download(randomUUID(), f.application.id, f.artifact.id))
  const path = f.bytes.paths(f.artifact).payload
  await writeFile(path, 'x'.repeat(f.artifact.sizeBytes))
  await assert.rejects(
    f.service.download(f.application.projectId, f.application.id, f.artifact.id),
    /摘要/,
  )
  await rm(path)
  await symlink(f.file, path)
  await assert.rejects(f.service.download(f.application.projectId, f.application.id, f.artifact.id))
})

test('模板白名单、历史投影、跨应用与损坏拒写；备份含模板且恢复校验归属', async (t) => {
  const f = await fixture(t),
    p = f.application.projectId,
    a = f.application.id
  await f.plans.freeze(...f.args, f.input)
  const input = {
    name: '常规更新',
    kind: 'single',
    entries: [
      {
        bindingId: f.binding.id,
        releaseNotes: '改进体验',
        mode: 'scheduled',
        huaweiAction: 'save_draft',
      },
    ],
  }
  await f.service.savePreset(p, a, input)
  const items = await f.service.reuse(p, a)
  assert.equal(items.length, 2)
  assert.equal(JSON.stringify(items).includes('authorization'), false)
  assert.equal(JSON.stringify(items).includes('artifactId'), false)
  assert.equal(JSON.stringify(items).includes('notBefore'), false)
  await assert.rejects(f.service.savePreset(p, a, { ...input, authorization: {} }))
  await assert.rejects(
    f.service.savePreset(p, a, {
      ...input,
      entries: [{ ...input.entries[0], bindingId: randomUUID() }],
    }),
  )
  const b = await f.local.backups.create(),
    raw = await f.local.backups.download(b.id)
  assert.ok(raw.includes('release-presets.json'))
  await f.local.backups.preview(raw)
  const preset = items.find((i) => i.source === 'template')
  assert.ok(preset)
  await assert.rejects(f.service.presets.remove(randomUUID(), a, preset.id))
  await f.service.presets.remove(p, a, preset.id)
  assert.equal((await f.service.reuse(p, a)).filter((i) => i.source === 'template').length, 0)
  const file = join(f.root, 'release-presets.json')
  await writeFile(file, '{')
  await assert.rejects(f.service.savePreset(p, a, input))
  assert.equal(await readFile(file, 'utf8'), '{')
})

test('备份手动批量删除不改变业务，API来源／确认与诊断零商店请求', async (t) => {
  const f = await fixture(t),
    b = await f.local.backups.create(),
    before = await readFile(f.file, 'utf8').catch(() => null)
  const api = await createApp(f.projects, {
    applicationStore: f.applicationsStore,
    localEfficiency: f.local,
    productivity: f.service,
  })
  t.after(() => api.close())
  const headers = {
    host: '127.0.0.1',
    origin: 'http://127.0.0.1:5178',
    'x-release-harbor-local': '1',
  }
  for (const url of [
    '/api/local/storage',
    '/api/local/diagnostics',
    `/api/local/reuse/${f.application.projectId}/${f.application.id}`,
  ])
    assert.equal((await api.inject({ url, headers })).statusCode, 200)
  assert.equal(f.calls(), 0)
  const url = '/api/local/backups/delete'
  assert.equal(
    (
      await api.inject({
        method: 'POST',
        url,
        headers: { host: '127.0.0.1' },
        payload: { ids: [b.id], acknowledged: true },
      })
    ).statusCode,
    403,
  )
  assert.equal(
    (
      await api.inject({
        method: 'POST',
        url,
        headers,
        payload: { ids: [b.id], acknowledged: false },
      })
    ).statusCode,
    400,
  )
  await assert.rejects(f.service.removeBackups({ ids: [b.id, randomUUID()], acknowledged: true }))
  assert.equal((await f.local.backups.list()).length, 1)
  assert.equal(
    (
      await api.inject({
        method: 'POST',
        url,
        headers,
        payload: { ids: [b.id], acknowledged: true },
      })
    ).statusCode,
    201,
  )
  assert.equal((await f.local.backups.list()).length, 0)
  assert.equal(await readFile(f.file, 'utf8').catch(() => null), before)
})
