/** @description 自动发布准备与一次确认的集成测试；使用隔离文件和合成端口，不访问真实商店。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { setup, terminal } from './fixtures/release-plans.ts'
import { isReleasePreparation } from '../packages/contracts/src/index.ts'
import { ReleasePreparationsService } from '../apps/api/src/release-preparations.service.ts'

function input(f: Awaited<ReturnType<typeof setup>>) {
  assert.ok(f.artifact.sha256)
  return {
    requestId: randomUUID(),
    bindingId: f.binding.id,
    artifactId: f.artifact.id,
    expectedBindingRevision: f.binding.revision,
    expectedArtifactSha256: f.artifact.sha256,
    releaseNotes: '自动准备测试说明',
  }
}
async function prepared(f: Awaited<ReturnType<typeof setup>>) {
  for (let n = 0; n < 200; n++) {
    const p = (await f.preparations.list(...f.args))[0]
    if (p && p.status !== 'checking') return p
    await delay(10)
  }
  throw new Error('准备未结束')
}

test('一次准备自动核验并生成无授权摘要，相同请求和刷新均不重放检查', async (t) => {
  const f = await setup(t, 'android')
  const body = input(f)
  const base = f.base.replace(/release-plans$/, 'release-preparations')
  const response = await f.api.inject({
    method: 'POST',
    url: base,
    headers: f.headers,
    payload: body,
  })
  assert.equal(response.statusCode, 202, response.body)
  assert.ok(isReleasePreparation(response.json().preparation))
  const duplicates = await Promise.all(
    Array.from({ length: 4 }, () => f.preparations.start(...f.args, body)),
  )
  assert.equal(new Set(duplicates.map((p) => p.id)).size, 1)
  const result = await prepared(f)
  assert.equal(result.status, 'ready')
  const plans = await f.store.list(...f.args)
  assert.equal(plans.length, 1)
  assert.equal(plans[0]?.authorization, null)
  assert.equal(plans[0]?.id, result.planId)
  assert.equal((await f.execution.list(...f.args)).length, 0)
  for (let n = 0; n < 3; n++)
    await f.api.inject({ method: 'GET', url: base, headers: { host: '127.0.0.1' } })
  assert.equal(f.calls(), 2, '夹具原预检一次，自动准备只新增一次')
  await assert.rejects(
    f.preparations.start(...f.args, { ...body, releaseNotes: '另一份说明' }),
    /另一份发布准备/,
  )
})

test('单次确认原子创建授权与执行，重复请求仅派发一次，无中间确认状态', async (t) => {
  let runs = 0
  const f = await setup(t, 'android', {
    async run(_p, _id, permit) {
      runs++
      await permit()
      return 'draft_saved'
    },
    close() {},
  })
  await f.preparations.start(...f.args, input(f))
  const ready = await prepared(f)
  const p = (await f.store.list(...f.args))[0]
  assert.ok(p)
  assert.equal(p.authorization, null)
  const response = await f.api.inject({
    method: 'POST',
    url: f.base + '/' + ready.planId + '/confirm-and-execute',
    headers: f.headers,
    payload: { expectedDigest: p.digest, acknowledged: true },
  })
  assert.equal(response.statusCode, 201, response.body)
  const attempts = await Promise.all(
    Array.from({ length: 4 }, () =>
      f.execution.start(...f.args, p.id, { expectedDigest: p.digest, acknowledged: true }, true),
    ),
  )
  assert.equal(new Set(attempts.map((a) => a.id)).size, 1)
  assert.equal((await terminal(f)).status, 'succeeded')
  assert.equal((await f.store.list(...f.args))[0]?.status, 'confirmed')
  assert.equal(runs, 1)
})

test('确认后续校验失败不会留下孤立授权，过期、取消、来源错误和额外字段均拒绝', async (t) => {
  const f = await setup(t, 'android')
  await f.preparations.start(...f.args, input(f))
  await prepared(f)
  const p = (await f.store.list(...f.args))[0]
  assert.ok(p)
  const body = { expectedDigest: p.digest, acknowledged: true }
  const route = f.base + '/' + p.id + '/confirm-and-execute'
  assert.equal(
    (
      await f.api.inject({
        method: 'POST',
        url: route,
        headers: { host: '127.0.0.1' },
        payload: body,
      })
    ).statusCode,
    403,
  )
  for (const bad of [
    { ...body, acknowledged: false },
    { ...body, token: '不允许材料' },
    { ...body, expectedDigest: 'b'.repeat(64) },
  ])
    assert.ok(
      (await f.api.inject({ method: 'POST', url: route, headers: f.headers, payload: bad }))
        .statusCode >= 400,
    )
  const failure = t.mock.method(f.plans, 'assertExecutable', async () => {
    throw new Error('合成晚期校验失败')
  })
  await assert.rejects(f.execution.start(...f.args, p.id, body, true))
  failure.mock.restore()
  assert.equal((await f.store.list(...f.args))[0]?.authorization, null)
  assert.equal((await f.execution.list(...f.args)).length, 0)
  f.advance(301000)
  await assert.rejects(f.execution.start(...f.args, p.id, body, true), /失效|过期/)
  f.advance(-301000)
  await f.plans.cancel(...f.args, p.id, { expectedDigest: p.digest })
  await assert.rejects(f.execution.start(...f.args, p.id, body, true), /失效/)
})

test('只读检查失败在准备结果中保留安全原因，无快照、授权或商店写入', async (t) => {
  let fail = false
  const f = await setup(t, 'android', undefined, {
    async check() {
      return fail
        ? {
            code: 'rejected',
            artifact: 'passed',
            authentication: 'unverified',
            target: 'unverified',
          }
        : { code: 'verified', artifact: 'passed', authentication: 'passed', target: 'passed' }
    },
  })
  fail = true
  await f.preparations.start(...f.args, input(f))
  const result = await prepared(f)
  assert.equal(result.status, 'failed')
  assert.equal(result.code, 'rejected')
  assert.equal((await f.store.list(...f.args)).length, 0)
  assert.equal((await f.execution.list(...f.args)).length, 0)
})

test('准备输入、旧版本、跨归属和不支持渠道不能触发查询；重启进行中不重放', async (t) => {
  const f = await setup(t, 'android')
  const body = input(f)
  for (const bad of [
    { ...body, expectedBindingRevision: 99 },
    { ...body, expectedArtifactSha256: 'b'.repeat(64) },
    { ...body, workspaceId: 'other' },
  ])
    await assert.rejects(f.preparations.start(...f.args, bad))
  await assert.rejects(f.preparations.start('other', f.args[1], f.args[2], body))
  assert.equal(f.calls(), 1)
  await f.store.execution(async (_plans, _attempts, preparations) => {
    preparations.push({
      id: body.requestId,
      workspaceId: f.args[0],
      projectId: f.args[1],
      applicationId: f.args[2],
      input: body,
      status: 'checking',
      code: 'checking',
      preflightId: null,
      planId: null,
      createdAt: new Date().toISOString(),
      finishedAt: null,
    })
  })
  const recovered = new ReleasePreparationsService(
    f.catalog,
    f.artifacts,
    f.preflights,
    f.plans,
    f.store,
  )
  assert.equal((await recovered.list(...f.args))[0]?.status, 'interrupted')
  assert.equal((await recovered.start(...f.args, body)).status, 'interrupted')
  assert.equal(f.calls(), 1)
  await writeFile(f.file, '{broken')
  await assert.rejects(recovered.list(...f.args), /无法读取/)
})

test('准备单槽不因重复请求产生第二次查询，检查期间绑定变化阻止准备通过', async (t) => {
  let waiting: Promise<void> | null = null
  let release: (() => void) | undefined
  const f = await setup(t, 'android', undefined, {
    async check() {
      if (waiting) await waiting
      return { code: 'verified', artifact: 'passed', authentication: 'passed', target: 'passed' }
    },
  })
  waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  const body = input(f)
  try {
    await f.preparations.start(...f.args, body)
    await assert.rejects(
      f.preparations.start(...f.args, { ...body, requestId: randomUUID() }),
      /准备进行中/,
    )
    await f.catalog.updateBinding(...f.args, f.binding.id, {
      appId: '654321',
      credentialReference: f.binding.credentialReference,
      expectedRevision: 1,
    })
  } finally {
    release?.()
  }
  const result = await prepared(f)
  assert.equal(result.status, 'failed')
  assert.equal((await f.store.list(...f.args)).length, 0)
  assert.equal((await f.execution.list(...f.args)).length, 0)
})
