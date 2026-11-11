/** @description 空间管理与配置复用的跨层验收；只使用隔离目录与合成产物，不访问真实商店。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readFile, writeFile, lstat, symlink, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { setup, confirmed, terminal } from './fixtures/release-plans.ts'
import type { ReleaseExecutor } from '../packages/runner-local/src/index.ts'
import { LocalProductivityService } from '../apps/api/src/local-productivity.service.ts'
import { localDataRoot, LocalBackupService } from '../apps/api/src/local-backup.ts'
import { LocalEfficiencyService } from '../apps/api/src/local-efficiency.service.ts'
import { LocalStateStore } from '../apps/api/src/local-state-store.ts'
import { LocalMaintenance } from '../apps/api/src/local-maintenance.ts'
import { LocalTrackingService } from '../apps/api/src/local-tracking.service.ts'
import { RecoverySafety } from '../apps/api/src/recovery-safety.ts'
import { assertBatchTargetUnblocked } from '../apps/api/src/release-batch-dispatch.ts'
import { StoreStatusService } from '../apps/api/src/store-status.service.ts'
import { StoreStatusStore } from '../apps/api/src/store-status-store.ts'
import { createApp } from '../apps/api/src/app.ts'

function gate() {
  let resolve = () => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function fixture(t: test.TestContext, executor?: ReleaseExecutor) {
  const f = await setup(t, 'android', executor),
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

test('失败与已清理记录可批量删除，重启不恢复；历史快照、回执及版本防重保留', async (t) => {
  const f = await fixture(t, {
    async run(_plan, _id, permit) {
      await permit()
      return 'draft_saved'
    },
    close() {},
  })
  const plan = await confirmed(f)
  await f.execution.start(...f.args, plan.id, { expectedDigest: plan.digest, acknowledged: true })
  assert.equal((await terminal(f)).status, 'succeeded')
  const before = await readFile(f.file, 'utf8')
  const failed = {
    ...f.artifact,
    id: randomUUID(),
    status: 'failed' as const,
    failureCode: 'upload_timeout' as const,
  }
  await f.bytes.create(failed)
  await f.service.cleanup({ ids: [f.artifact.id], acknowledged: true })
  await f.service.deleteArtifacts({ ids: [failed.id, f.artifact.id], acknowledged: true })
  assert.deepEqual((await f.service.storage()).artifacts, [])
  assert.deepEqual(await f.artifacts.list(...f.args), [])
  await assert.rejects(lstat(f.bytes.paths(failed).directory))
  await assert.rejects(lstat(f.bytes.paths(f.artifact).directory))
  await f.bytes.initialize()
  assert.deepEqual(await f.artifacts.list(...f.args), [])
  assert.equal(await readFile(f.file, 'utf8'), before)
  const historical = (await f.plans.list(...f.args)).find((v) => v.plan.id === plan.id)
  assert.equal(historical?.current, false)
  assert.deepEqual(historical?.plan.snapshot.artifact, plan.snapshot.artifact)
  assert.equal((await f.execution.list(...f.args))[0]?.status, 'succeeded')
  // 防重仅依赖不可变计划和执行事实，安装包目录消失不允许同版本再次提交。
  const history = await f.store.backupState()
  assert.throws(() => assertBatchTargetUnblocked(plan, history.plans, history.attempts), /受理/)
  const backup = await f.local.backups.create()
  await f.local.backups.preview(await f.local.backups.download(backup.id))
  assert.equal(f.calls(), 0)
})

test('删除整组预验状态与归属；可用、活动、跨空间和无效选项不导致部分删除', async (t) => {
  const f = await fixture(t)
  const failed = {
    ...f.artifact,
    id: randomUUID(),
    status: 'failed' as const,
    failureCode: 'upload_timeout' as const,
  }
  await f.bytes.create(failed)
  const remove = (ids: string[]) => f.service.deleteArtifacts({ ids, acknowledged: true })
  await assert.rejects(remove([failed.id, f.artifact.id]), /只能删除/)
  await assert.rejects(remove([failed.id, randomUUID()]), /不存在/)
  const other = { ...failed, id: randomUUID(), workspaceId: 'other' }
  await f.bytes.create(other)
  await assert.rejects(remove([failed.id, other.id]), /不存在/)
  await assert.rejects(f.bytes.deleteFailed([{ ...other, workspaceId: 'local' }]), /不存在/)
  for (const status of ['receiving', 'checking'] as const) {
    const active = { ...f.artifact, id: randomUUID(), status }
    await f.bytes.create(active)
    await assert.rejects(remove([failed.id, active.id]), /导入/)
    await f.bytes.update({ ...active, status: 'failed', failureCode: 'interrupted' })
  }
  f.maintenance.tasks++
  await assert.rejects(remove([failed.id]), /活动/)
  f.maintenance.tasks--
  assert.ok(await lstat(f.bytes.paths(failed).directory))
  assert.ok(await lstat(f.bytes.paths(f.artifact).payload))
  await remove([failed.id])
  await assert.rejects(remove([failed.id]), /不存在/)
})

test('删除记录 API 要求可信来源、显式确认与精确字段，成功后目录和详情均不再返回', async (t) => {
  const f = await fixture(t)
  const failed = {
    ...f.artifact,
    id: randomUUID(),
    status: 'failed' as const,
    failureCode: 'inspection_failed' as const,
  }
  await f.bytes.create(failed)
  const api = await createApp(f.projects, {
    applicationStore: f.applicationsStore,
    artifacts: f.artifacts,
    localEfficiency: f.local,
    productivity: f.service,
  })
  t.after(() => api.close())
  const headers = {
    host: '127.0.0.1',
    origin: 'http://127.0.0.1:5178',
    'x-release-harbor-local': '1',
  }
  const url = '/api/local/artifacts/delete'
  const payload = { ids: [failed.id], acknowledged: true }
  for (const rejected of [
    { host: '127.0.0.1' },
    { ...headers, origin: 'http://evil.invalid' },
    { ...headers, 'x-release-harbor-local': '' },
  ])
    assert.equal(
      (await api.inject({ method: 'POST', url, headers: rejected, payload })).statusCode,
      403,
    )
  for (const rejected of [
    { ...payload, acknowledged: false },
    { ...payload, ids: [] },
    { ...payload, ids: [failed.id, failed.id] },
    { ...payload, ids: Array.from({ length: 101 }, () => randomUUID()) },
    { ...payload, path: '/tmp/untrusted' },
  ])
    assert.equal(
      (await api.inject({ method: 'POST', url, headers, payload: rejected })).statusCode,
      400,
    )
  assert.equal((await api.inject({ method: 'POST', url, headers, payload })).statusCode, 201)
  const base = `/api/projects/${f.application.projectId}/applications/${f.application.id}/artifacts`
  assert.equal((await api.inject({ url: `${base}/${failed.id}`, headers })).statusCode, 404)
  const result = await api.inject({ url: base, headers })
  assert.deepEqual(
    result.json().items.map((v: { id: string }) => v.id),
    [f.artifact.id],
  )
  assert.equal(f.calls(), 0)
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

test('离页中断响应后，维护等待原处理结束再释放且不重复扣减', { timeout: 10000 }, async (t) => {
  // 1. 隔离服务固定等待，使离页中断先于处理完成。
  const f = await fixture(t)
  const started = gate()
  const pending = gate()
  const activeRequests = () => f.maintenance.requests
  // 固定在真实 HTTP 处理边界中断，验证响应关闭与处理完成之间的维护占用。
  f.service.diagnostics = async () => {
    started.resolve()
    await pending.promise
    return []
  }
  const api = await createApp(f.projects, {
    applicationStore: f.applicationsStore,
    localEfficiency: f.local,
    productivity: f.service,
  })
  t.after(() => api.close())
  // 2. 使用真实回环连接确认响应关闭，处理仍运行时维护必须拒绝。
  await api.listen(0, '127.0.0.1')
  const origin = await api.getUrl()
  const closed = gate()
  api
    .getHttpAdapter()
    .getInstance()
    .server.on('request', (_request: unknown, response: import('node:http').ServerResponse) => {
      response.once('close', () => closed.resolve())
    })
  const abort = new AbortController()
  const request = fetch(origin + '/api/local/diagnostics', { signal: abort.signal }).catch(
    () => null,
  )
  await started.promise
  abort.abort()
  await request
  await closed.promise
  assert.equal(f.maintenance.requests, 1, '断开客户端不能提前释放仍运行的处理')
  await assert.rejects(
    f.maintenance.exclusive(async () => {}, 0),
    /活动/,
  )
  // 3. 完成处理后归还占用，再核对正常响应不会二次扣减。
  pending.resolve()
  // 以有界轮询等待真实响应生命周期结束，不用固定长延时掩盖占用泄漏。
  for (let n = 0; n < 100 && activeRequests() !== 0; n++)
    await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(f.maintenance.requests, 0, '处理结束后，中断响应也必须归还请求占用')
  await f.maintenance.exclusive(async () => {}, 0)
  assert.equal((await fetch(origin + '/api/local/diagnostics')).status, 200)
  assert.equal(f.maintenance.requests, 0, '正常响应不能重复扣减')
})
