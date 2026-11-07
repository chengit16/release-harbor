/** @description 查询证据留存回归；隔离存储验证迁移、边界与错误保护，比较规则不制造版本关联。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { StoreStatusStore } from '../apps/api/src/store-status-store.ts'
import {
  isStoreStatusResponse,
  type StoreStatusSnapshot,
  type StoreStatusTarget,
  type StoreVersionStatus,
} from '../packages/contracts/src/index.ts'
import { compareStoreStatusHistory } from '../apps/web/src/pages/reviewTracking/storeStatusHistory.ts'

const bindingId = randomUUID(),
  key = 'a'.repeat(64)
function snapshot(
  state: StoreVersionStatus['state'] = 'in_review',
  index = 0,
): StoreStatusSnapshot {
  return {
    bindingId,
    channel: 'oppo',
    checkedAt: new Date(1700000000000 + index * 11000).toISOString(),
    code: 'observed',
    versions: [{ versionId: null, versionName: '2.0', buildNumber: '42', state, rawState: null }],
  }
}
async function fixture(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'harbor-query-history-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const file = join(root, 'store-status.json')
  return { file, store: new StoreStatusStore(file) }
}

test('schema1与2只读不迁移或伪造历史，新完成查询原子升级schema4并保留旧缓存', async (t) => {
  const { file, store } = await fixture(t)
  for (const schemaVersion of [1, 2]) {
    const entry = {
      key,
      requestedAt: 0,
      pending: false,
      snapshots: [snapshot()],
      ...(schemaVersion === 2 ? { trackedSnapshots: [], manualRecords: [] } : {}),
    }
    const bytes = JSON.stringify({ schemaVersion, entries: [entry] })
    await writeFile(file, bytes)
    assert.deepEqual((await store.tracking([key])).queryHistory, [])
    assert.equal(await readFile(file, 'utf8'), bytes)
    await store.reserve(key, 1700000000000)
    const failure = { ...snapshot(), code: 'network' as const, versions: [] }
    await store.finish(key, failure)
    const data = await new StoreStatusStore(file).tracking([key])
    assert.deepEqual(data.queryHistory, [failure])
    assert.deepEqual(data.snapshots, [failure, snapshot()])
    assert.equal(JSON.parse(await readFile(file, 'utf8')).schemaVersion, 4)
  }
})

test('最近三十次共用默认和指定构建预算，失败与重复状态均留存，指纹隔离', async (t) => {
  const { file, store } = await fixture(t)
  const expected: StoreStatusSnapshot[] = []
  for (let i = 0; i < 33; i++) {
    const item = snapshot('in_review', i)
    if (i % 2) item.query = { kind: 'oppo_build', buildNumber: '42' }
    if (i % 3 === 0) {
      item.code = 'network'
      item.versions = []
    }
    await store.reserve(key, 1700000000000 + i * 11000)
    await store.finish(key, item)
    expected.unshift(item)
  }
  const data = await new StoreStatusStore(file).tracking([key])
  assert.deepEqual(data.queryHistory, expected.slice(0, 30))
  assert.ok(data.snapshots.length <= 2)
  assert.ok(data.trackedSnapshots.length <= 2)
  assert.deepEqual((await store.tracking(['b'.repeat(64)])).queryHistory, [])
  const bytes = await readFile(file, 'utf8')
  await store.tracking([key])
  assert.equal(await readFile(file, 'utf8'), bytes)
})

test('跨绑定、渠道、超限及夹带原始意见的历史损坏时拒读且不覆盖', async (t) => {
  const { file, store } = await fixture(t)
  for (const queryHistory of [
    [{ ...snapshot(), bindingId: randomUUID() }],
    [{ ...snapshot(), channel: 'vivo' }],
    Array.from({ length: 31 }, () => snapshot()),
    [{ ...snapshot(), reviewOpinion: '禁止传播的原文' }],
  ]) {
    const bytes = JSON.stringify({
      schemaVersion: 3,
      entries: [
        {
          key,
          requestedAt: 0,
          pending: false,
          snapshots: [snapshot()],
          trackedSnapshots: [],
          manualRecords: [],
          queryHistory,
        },
      ],
    })
    await writeFile(file, bytes)
    await assert.rejects(store.tracking([key]), /无法读取/)
    await assert.rejects(store.reserve(key), /无法读取/)
    assert.equal(await readFile(file, 'utf8'), bytes)
  }
})

test('变化仅比较同绑定同范围的成功，失败无变化，缺项不推断下架或实际发生时间', () => {
  const older = snapshot('in_review'),
    current = snapshot('approved', 3)
  const failure = { ...snapshot('unknown', 2), code: 'network' as const, versions: [] }
  const otherBuild = {
    ...snapshot('rejected', 1),
    query: { kind: 'oppo_build' as const, buildNumber: '42' },
  }
  const history = [current, failure, { ...older, bindingId: randomUUID() }, otherBuild, older]
  const result = compareStoreStatusHistory(history, 0)
  assert.equal(result.baseline, older)
  assert.deepEqual(result.changes, [
    { kind: 'changed', version: current.versions[0], previous: older.versions[0] },
  ])
  assert.deepEqual(compareStoreStatusHistory(history, 1).changes, [])
  assert.equal(compareStoreStatusHistory(history, 3).baseline, undefined)
  const empty = { ...current, versions: [] }
  assert.deepEqual(compareStoreStatusHistory([empty, older], 0).changes, [
    { kind: 'not_returned', version: older.versions[0] },
  ])
  assert.deepEqual(compareStoreStatusHistory([older, older], 0).changes, [])
  const previous = older.versions[0]
  assert.ok(previous)
  for (const versions of [
    [{ ...previous, buildNumber: null }],
    [previous, previous],
    [{ ...previous, buildNumber: '43' }],
    [{ ...previous, versionId: 'new-id' }],
  ]) {
    const differences = compareStoreStatusHistory([{ ...current, versions }, older], 0).changes
    assert.ok(differences.every((item) => item.kind !== 'changed' && !item.previous))
  }
})

test('公开历史守卫兼容省略字段，但拒绝跨目标、超限、未知字段和伪造来源', () => {
  const target: StoreStatusTarget = {
    bindingId,
    projectId: randomUUID(),
    projectName: '项目',
    applicationId: randomUUID(),
    applicationName: '应用',
    platform: 'android',
    identifier: 'com.example.history',
    channel: 'oppo',
    appId: 'com.example.history',
    querySupported: true,
    queryNotice: null,
  }
  const response = { targets: [target], snapshots: [snapshot()] }
  assert.equal(isStoreStatusResponse(response), true)
  assert.equal(isStoreStatusResponse({ ...response, queryHistory: [snapshot()] }), true)
  for (const queryHistory of [
    [{ ...snapshot(), bindingId: randomUUID() }],
    [{ ...snapshot(), channel: 'meizu' }],
    [{ ...snapshot(), source: 'local_user' }],
    Array.from({ length: 31 }, () => snapshot()),
    'invalid',
  ])
    assert.equal(isStoreStatusResponse({ ...response, queryHistory }), false)
})
