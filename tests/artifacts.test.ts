/** @description 产物流式边界、隔离、检查、失败清理和中断恢复，全部使用合成数据与临时目录。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { request as httpRequest } from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import {
  artifactLimits,
  isArtifactRecord,
  isRecord,
  type ArtifactRecord,
} from '../packages/contracts/src/index.ts'
import { ApplicationCatalog, DomainError, ProjectCatalog } from '../packages/domain/src/index.ts'
import {
  LocalArtifactInspector,
  type ArtifactInspector,
  type InspectionOutcome,
  type InspectionTask,
} from '../packages/runner-local/src/index.ts'
import { isInspectionTask } from '../packages/runner-local/src/protocol.ts'
import { inspectBoundArtifact } from '../packages/runner-local/src/inspect.ts'
import { FileArtifactStore } from '../apps/api/src/artifact-store.ts'
import { FileApplicationStore } from '../apps/api/src/application-store.ts'
import { FileProjectStore } from '../apps/api/src/project-store.ts'
import { ArtifactsService } from '../apps/api/src/artifacts.service.ts'
import { createApp } from '../apps/api/src/app.ts'
import { syntheticIpa } from './fixtures/ipa.ts'
import { syntheticApk } from './fixtures/apk.ts'

class ControlledInspector implements ArtifactInspector {
  task: InspectionTask | null = null
  private complete: ((value: InspectionOutcome) => void) | null = null
  inspect(task: InspectionTask): Promise<InspectionOutcome> {
    this.task = task
    return new Promise((resolve) => {
      this.complete = resolve
    })
  }
  finish(): void {
    assert.ok(this.task)
    this.complete?.({
      identity: {
        format: this.task.format,
        packageName: this.task.target.identifier,
        versionName: '1.2.3',
        buildNumber: '42',
        sizeBytes: this.task.sizeBytes,
        sha256: this.task.sha256,
      },
      failureCode: null,
    })
  }
  close(): void {
    this.complete?.({ identity: null, failureCode: 'interrupted' })
  }
}

async function fixture(
  t: test.TestContext,
  inspector: ArtifactInspector = new LocalArtifactInspector(),
) {
  const temporary = await mkdtemp(join(tmpdir(), 'release-harbor-artifact-'))
  const root = await realpath(temporary)
  const projects = new FileProjectStore(join(root, 'projects.json'))
  const applications = new FileApplicationStore(join(root, 'applications.json'))
  const project = await new ProjectCatalog(projects).create('local', {
    name: '产物合成测试',
    key: 'artifact-test',
    framework: 'native',
  })
  const otherProject = await new ProjectCatalog(projects).create('local', {
    name: '其他项目',
    key: 'other-project',
    framework: 'native',
  })
  const catalog = new ApplicationCatalog(projects, applications)
  const application = await catalog.create('local', project.id, {
    name: '合成 iOS',
    platform: 'ios',
    identifier: 'com.example.ios',
  })
  const store = new FileArtifactStore(join(root, 'artifacts'))
  const service = new ArtifactsService(catalog, store, inspector)
  const app = await createApp(projects, { applicationStore: applications, artifacts: service })
  t.after(async () => {
    await app.close()
    await rm(root, { recursive: true, force: true })
  })
  const url = `/api/projects/${project.id}/applications/${application.id}/artifacts`
  return { app, store, service, root, project, otherProject, application, catalog, url }
}

function headers(name: string, size: number) {
  return {
    'content-type': 'application/octet-stream',
    'x-artifact-name': encodeURIComponent(name),
    'x-artifact-size': String(size),
  }
}
function recordFrom(body: unknown): ArtifactRecord {
  assert.ok(isRecord(body) && isArtifactRecord(body.artifact))
  return body.artifact
}
async function terminal(load: () => Promise<ArtifactRecord[]>): Promise<ArtifactRecord> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const record = (await load())[0]
    if (record?.status === 'ready' || record?.status === 'failed') return record
    await delay(50)
  }
  throw new Error('检查未进入末态')
}

test('真实独立进程解析合成 IPA，返回实际身份、版本与摘要，重读不暴露路径', async (t) => {
  const { app, url, service, application, project } = await fixture(t)
  const bytes = syntheticIpa()
  const response = await app.inject({
    method: 'POST',
    url,
    headers: headers('合成测试.ipa', bytes.length),
    payload: bytes,
  })
  assert.equal(response.statusCode, 202)
  assert.equal(recordFrom(response.json()).status, 'checking')
  const record = await terminal(() => service.list('local', project.id, application.id))
  assert.equal(record.status, 'ready')
  assert.equal(record.identity?.packageName, 'com.example.ios')
  assert.equal(record.identity?.buildNumber, '42')
  assert.equal(record.sha256, createHash('sha256').update(bytes).digest('hex'))
  const detail = await app.inject(`${url}/${record.id}`)
  assert.equal(detail.statusCode, 200)
  assert.ok(
    !detail.body.includes('storageRoot') &&
      !detail.body.includes('payload.ipa') &&
      !detail.body.includes('absolutePath'),
  )
})

test('二进制 Info.plist 在真实检查进程中保持字节完整，检查不改写原 IPA', async (t) => {
  const { app, url, service, store, application, project } = await fixture(t)
  const bytes = syntheticIpa('com.example.ios', true)
  const response = await app.inject({
    method: 'POST',
    url,
    headers: headers('binary.ipa', bytes.length),
    payload: bytes,
  })
  assert.equal(response.statusCode, 202)
  const record = await terminal(() => service.list('local', project.id, application.id))
  assert.equal(record.status, 'ready', `二进制 plist 解析失败：${record.failureCode}`)
  assert.equal(record.identity?.packageName, 'com.example.ios')
  assert.equal(record.identity?.versionName, '1.2.3')
  assert.equal(record.identity?.buildNumber, '42')
  assert.equal(record.sha256, createHash('sha256').update(bytes).digest('hex'))
  assert.deepEqual(await readFile(store.paths(record).payload), bytes)
})

test('真实检查拒绝错配身份与损坏字节，清理文件但保留失败事实', async (t) => {
  const { app, url, service, store, application, project } = await fixture(t)
  for (const [name, bytes, expected] of [
    ['错配.ipa', syntheticIpa('com.example.other'), 'identity_mismatch'],
    ['损坏.ipa', Buffer.from('not-an-archive'), 'inspection_failed'],
  ] as const) {
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: headers(name, bytes.length),
          payload: bytes,
        })
      ).statusCode,
      202,
    )
    const record = await terminal(() => service.list('local', project.id, application.id))
    assert.equal(record.status, 'failed')
    assert.equal(record.failureCode, expected)
    await assert.rejects(stat(store.paths(record).payload), { code: 'ENOENT' })
  }
})

test('单槽位检查不占用 HTTP，第二次上传拒绝且旧记录不会被重发', async (t) => {
  const inspector = new ControlledInspector()
  const { app, url, service, application, project } = await fixture(t, inspector)
  const bytes = syntheticIpa()
  const input = {
    method: 'POST' as const,
    url,
    headers: headers('sample.ipa', bytes.length),
    payload: bytes,
  }
  assert.equal((await app.inject(input)).statusCode, 202)
  assert.equal((await app.inject(input)).statusCode, 409)
  assert.equal((await app.inject('/api/health')).statusCode, 200)
  assert.equal((await service.list('local', project.id, application.id)).length, 1)
  inspector.finish()
  assert.equal(
    (await terminal(() => service.list('local', project.id, application.id))).status,
    'ready',
  )
})

test('上传拒绝大小、格式、路径和非法元数据，跨父级及跨站入口不写入', async (t) => {
  const { app, url, otherProject, application } = await fixture(t)
  const bytes = Buffer.from('bytes')
  for (const name of ['../path.ipa', '/tmp/a.ipa', 'bad\n.ipa', 'a.apk', '.hidden.ipa']) {
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: headers(name, bytes.length),
          payload: bytes,
        })
      ).statusCode,
      400,
    )
  }
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url,
        headers: headers('large.ipa', artifactLimits.maxFileBytes + 1),
        payload: bytes,
      })
    ).statusCode,
    413,
  )
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url,
        headers: headers('empty.ipa', 0),
        payload: Buffer.alloc(0),
      })
    ).statusCode,
    400,
  )
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: `/api/projects/${otherProject.id}/applications/${application.id}/artifacts`,
        headers: headers('a.ipa', bytes.length),
        payload: bytes,
      })
    ).statusCode,
    404,
  )
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url,
        headers: { ...headers('a.ipa', bytes.length), origin: 'https://untrusted.example' },
        payload: bytes,
      })
    ).statusCode,
    403,
  )
  assert.equal((await app.inject(url)).json().items.length, 0)
})

test('流式实际长度独立核对，失败后释放槽位并清理部分文件', async (t) => {
  const { app, url, service, store, project, application } = await fixture(t)
  const response = await app.inject({
    method: 'POST',
    url,
    headers: { ...headers('short.ipa', 20), 'transfer-encoding': 'chunked' },
    payload: Readable.from([Buffer.from('short')]),
  })
  assert.equal(response.statusCode, 400)
  const record = (await service.list('local', project.id, application.id))[0]
  assert.ok(record)
  assert.equal(record.failureCode, 'upload_incomplete')
  await assert.rejects(stat(store.paths(record).partial), { code: 'ENOENT' })
  const valid = syntheticIpa()
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url,
        headers: headers('after.ipa', valid.length),
        payload: valid,
      })
    ).statusCode,
    202,
  )
  await terminal(() => service.list('local', project.id, application.id))
})

test('启动恢复接收中记录，不重新检查；未知版本拒绝覆盖原始记录', async (t) => {
  const { store, root, project, application } = await fixture(t)
  const now = new Date().toISOString()
  const record: ArtifactRecord = {
    id: randomUUID(),
    workspaceId: 'local',
    projectId: project.id,
    applicationId: application.id,
    fileName: 'interrupted.ipa',
    format: 'ipa',
    status: 'receiving',
    expectedSizeBytes: 100,
    sizeBytes: 0,
    sha256: null,
    identity: null,
    failureCode: null,
    createdAt: now,
    updatedAt: now,
  }
  await store.create(record)
  await writeFile(store.paths(record).partial, 'partial')
  const reloaded = new FileArtifactStore(join(root, 'artifacts'))
  await reloaded.initialize()
  assert.equal(
    (await reloaded.list('local', project.id, application.id))[0]?.failureCode,
    'interrupted',
  )
  await assert.rejects(stat(store.paths(record).partial), { code: 'ENOENT' })
  const path = join(store.paths(record).directory, 'record.json')
  const corrupted = (await readFile(path, 'utf8')).replace(
    '"schemaVersion": 1',
    '"schemaVersion": 2',
  )
  await writeFile(path, corrupted)
  await assert.rejects(reloaded.initialize(), { statusCode: 500 })
  assert.equal(await readFile(path, 'utf8'), corrupted)
})

test('worker 协议拒绝其他动作、路径与符号链接，摘要变化不能跳过检查', async (t) => {
  const { app, url, store, project, application } = await fixture(t, new ControlledInspector())
  const bytes = syntheticIpa()
  const result = await app.inject({
    method: 'POST',
    url,
    headers: headers('a.ipa', bytes.length),
    payload: bytes,
  })
  const record = recordFrom(result.json())
  assert.ok(record.sha256)
  const task: InspectionTask = {
    schemaVersion: 1,
    action: 'inspect',
    nonce: randomBytes(16).toString('hex'),
    artifactId: record.id,
    storageRoot: store.storageRoot(),
    format: 'ipa',
    sizeBytes: bytes.length,
    sha256: record.sha256,
    target: {
      workspaceId: 'local',
      projectId: project.id,
      applicationId: application.id,
      platform: 'ios',
      identifier: 'com.example.ios',
    },
  }
  assert.equal(isInspectionTask({ ...task, action: 'publish' }), false)
  assert.equal(isInspectionTask({ ...task, artifactId: '../outside' }), false)
  const changed = await inspectBoundArtifact({ ...task, sha256: '0'.repeat(64) })
  assert.equal(changed.failureCode, 'digest_mismatch')
  await rm(store.paths(record).payload)
  await symlink(join(store.paths(record).directory, 'record.json'), store.paths(record).payload)
  assert.equal((await inspectBoundArtifact(task)).failureCode, 'digest_mismatch')
})

test('真实 HTTP 上传中断保留失败记录，后续请求可继续接收', async (t) => {
  const { app, url, service, project, application } = await fixture(t)
  await app.listen(0, '127.0.0.1')
  const origin = await app.getUrl()
  const outgoing = httpRequest(origin + url, {
    method: 'POST',
    headers: { ...headers('断流.ipa', 100), 'transfer-encoding': 'chunked' },
  })
  outgoing.on('error', () => {
    /* 此连接由测试主动中断，错误是被保护的输入场景。 */
  })
  outgoing.write(Buffer.from('partial'))
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await service.list('local', project.id, application.id)).length) break
    await delay(10)
  }
  outgoing.destroy()
  const record = await terminal(() => service.list('local', project.id, application.id))
  assert.equal(record.failureCode, 'upload_incomplete')
  const bytes = syntheticIpa()
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url,
        headers: headers('之后.ipa', bytes.length),
        payload: bytes,
      })
    ).statusCode,
    202,
  )
  assert.equal(
    (await terminal(() => service.list('local', project.id, application.id))).status,
    'ready',
  )
})

test('预算按未完成预留量计算，磁盘不足时不创建产物记录', async (t) => {
  const { app, url, store, service, project, application } = await fixture(t)
  const capacity = t.mock.method(store, 'assertCapacity', async () => {
    throw new DomainError('磁盘空间不足', 507)
  })
  const bytes = syntheticIpa()
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url,
        headers: headers('a.ipa', bytes.length),
        payload: bytes,
      })
    ).statusCode,
    507,
  )
  assert.equal((await service.list('local', project.id, application.id)).length, 0)
  capacity.mock.restore()
  // 只构造接收预留，不分配大文件或把合成记录标为检查成功。
  for (let index = 0; index < 8; index++) {
    const now = new Date().toISOString()
    await store.create({
      id: randomUUID(),
      workspaceId: 'local',
      projectId: project.id,
      applicationId: application.id,
      fileName: `reservation-${index}.ipa`,
      format: 'ipa',
      status: 'receiving',
      expectedSizeBytes: artifactLimits.maxFileBytes,
      sizeBytes: 0,
      sha256: null,
      identity: null,
      failureCode: null,
      createdAt: now,
      updatedAt: now,
    })
  }
  await assert.rejects(store.assertCapacity(1), { statusCode: 507 })
  await store.initialize()
  await store.assertCapacity(1)
})

test('本机 aapt2 生成的合成 APK 经独立执行进程读取真实 Manifest', async (t) => {
  const { app, service, project, catalog, root } = await fixture(t)
  const bytes = await syntheticApk(root)
  if (!bytes) {
    t.skip('本机缺少 Android SDK，未执行真实 APK 解析验收')
    return
  }
  const android = await catalog.create('local', project.id, {
    name: '合成 Android',
    platform: 'android',
    identifier: 'com.example.android',
  })
  const url = `/api/projects/${project.id}/applications/${android.id}/artifacts`
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url,
        headers: headers('synthetic.apk', bytes.length),
        payload: bytes,
      })
    ).statusCode,
    202,
  )
  const record = await terminal(() => service.list('local', project.id, android.id))
  assert.equal(record.status, 'ready')
  assert.equal(record.identity?.packageName, 'com.example.android')
  assert.equal(record.identity?.buildNumber, '7')
  assert.equal(record.identity?.versionName, '0.1.0')
})
