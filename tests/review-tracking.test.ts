/** @description 审核状态菜单安全汇总回归，合成执行与只读观察，不读取真实凭据或请求商店。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { ProjectCatalog } from '../packages/domain/src/index.ts'
import { setup, confirmed, terminal } from './fixtures/release-plans.ts'
import { ReleaseObservationService } from '../apps/api/src/release-observation.service.ts'
import { ReleaseObservationStore } from '../apps/api/src/release-observation-store.ts'
import { ReviewTrackingService } from '../apps/api/src/review-tracking.service.ts'
import {
  isReviewTrackingResponse,
  type ReleaseObservation,
} from '../packages/contracts/src/index.ts'
import { createApp } from '../apps/api/src/app.ts'

test('独立审核菜单仅汇总已执行送审目标，读记录零查询且不传输快照、账号或授权', async (t) => {
  const f = await setup(
    t,
    'android',
    {
      async run(_p, _id, permit) {
        await permit()
        return 'honor_review_submitted'
      },
      close() {},
    },
    { channel: 'honor' },
  )
  const plan = await confirmed(f)
  const file = join(f.root, 'observations.json')
  let queries = 0
  const observations = new ReleaseObservationService(
    f.catalog,
    f.store,
    new ReleaseObservationStore(file),
    {
      async run() {
        queries++
        return { state: 'in_review', code: 'observed', rawState: 0 }
      },
      close() {},
    },
  )
  const api = await createApp(f.projects, {
    applicationStore: f.applicationsStore,
    releasePlans: f.plans,
    execution: f.execution,
    observations,
  })
  t.after(() => api.close())
  const get = async () => {
    const before = await readFile(f.file, 'utf8'),
      mtime = (await stat(f.file)).mtimeMs,
      checks = f.calls()
    const response = await api.inject({
      method: 'GET',
      url: '/api/review-tracking?workspaceId=foreign',
      headers: { host: '127.0.0.1' },
    })
    assert.equal(response.statusCode, 200)
    const body: unknown = response.json()
    assert.ok(isReviewTrackingResponse(body))
    assert.equal(await readFile(f.file, 'utf8'), before)
    assert.equal((await stat(f.file)).mtimeMs, mtime)
    assert.equal(f.calls(), checks)
    for (const value of [
      'snapshot',
      'credentialReference',
      'authorization',
      'synthetic-plan-account',
      'digest',
    ])
      assert.equal(JSON.stringify(body).includes(value), false)
    return body
  }
  assert.equal((await get()).items.length, 0, '尚未执行的计划不能伪装成已送审')
  await f.execution.start(...f.args, plan.id, { expectedDigest: plan.digest, acknowledged: true })
  await terminal(f)
  await f.plans.freeze(...f.args, { ...f.input, requestId: randomUUID() })
  await new ProjectCatalog(f.projects).create('foreign', {
    key: 'foreign',
    name: '外部空间',
    framework: 'native',
  })
  const empty = await get()
  assert.equal(empty.projects.length, 1)
  assert.equal(empty.items.length, 1)
  assert.equal(empty.items[0]?.state, 'not_queried')
  assert.equal(empty.items[0]?.todo, 'query')
  assert.equal(queries, 0)
  const observation = await observations.query(f.args[1], f.args[2], plan.id)
  const mtime = (await stat(file)).mtimeMs
  const observed = await get()
  assert.equal(observed.items[0]?.observation?.id, observation.id)
  assert.equal(observed.items[0]?.state, 'in_review')
  assert.equal(observed.items[0]?.todo, 'wait')
  assert.equal(queries, 1)
  assert.equal((await stat(file)).mtimeMs, mtime)
  const row = observed.items[0]
  assert.ok(row)
  for (const patch of [
    { snapshot: plan.snapshot },
    { observation: { ...observation, planId: randomUUID() } },
    { observation: { ...observation, versionName: 'other-version' } },
    {
      appleObservation: {
        state: 'IN_REVIEW',
        checkedAt: observation.checkedAt,
        secret: 'forbidden',
      },
    },
  ])
    assert.equal(isReviewTrackingResponse({ ...observed, items: [{ ...row, ...patch }] }), false)
  const unrecognized: ReleaseObservation = { ...observation, state: 'unknown', rawState: 77 }
  const unknownSource = new ReviewTrackingService(f.projects, f.catalog, f.plans, f.execution, {
    async applicationHistory() {
      return [unrecognized]
    },
  })
  assert.equal(
    (await unknownSource.list()).items[0]?.todo,
    'verify',
    '未知阶段应提示核对，不推断当前审核进度',
  )
  const broken = new ReviewTrackingService(f.projects, f.catalog, f.plans, f.execution, {
    async applicationHistory() {
      throw Error('合成观察损坏')
    },
  })
  await assert.rejects(broken.list(), /合成观察损坏/)
  await writeFile(file, '{broken')
  const failure = await api.inject({
    method: 'GET',
    url: '/api/review-tracking',
    headers: { host: '127.0.0.1' },
  })
  assert.equal(failure.statusCode, 500)
  assert.equal(Object.hasOwn(failure.json(), 'items'), false)
  assert.equal(await readFile(file, 'utf8'), '{broken')
})
