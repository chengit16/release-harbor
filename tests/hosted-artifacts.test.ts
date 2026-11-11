/** @description 在线分片验收，真实 PostgreSQL、隔离版本桶、合成 APK 字节和 Chrome。 */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { request as httpsRequest } from 'node:https'
import { setTimeout as delay } from 'node:timers/promises'
import { test, type TestContext } from 'node:test'
import { chromium } from '@playwright/test'
import { hostedArtifactLimits as limits } from '../packages/contracts/src/hosted-artifacts.ts'
import { sweepHostedArtifacts } from '../apps/api/src/hosted/artifacts/sweep.ts'
import type { HostedArtifactStorage } from '../apps/api/src/hosted/artifacts/storage.ts'
import { hostedTestStorage } from './fixtures/hosted-artifact-storage.ts'
import { hostedFixture } from './fixtures/hosted-workspace.ts'

const database = process.env.RELEASE_HARBOR_HOSTED_TEST_DATABASE_URL
const objectEndpoint = process.env.RELEASE_HARBOR_HOSTED_TEST_S3_ENDPOINT
const browserEnabled = process.env.RELEASE_HARBOR_HOSTED_TEST_BROWSER === '1'
type Fixture = Awaited<ReturnType<typeof hostedFixture>>

test(
  '在线安装包：真实分片、版本冻结、空间隔离和回收',
  { skip: !database || !objectEndpoint, timeout: 120000 },
  async (t) => {
    assert.ok(database)
    let storage: HostedArtifactStorage | undefined
    const fixture = await hostedFixture(t, database, browserEnabled, async (tls, origin) => {
      storage = await hostedTestStorage(t, tls, origin)
      return storage
    })
    const artifactStorage = storage
    assert.ok(artifactStorage)
    const admin = await login(fixture, 'pilot-admin')
    const other = await login(fixture, 'other-admin')
    const scope = await appPath(fixture, fixture.first, admin)
    const outsider = await appPath(fixture, fixture.second, other)
    const full = Buffer.alloc(limits.partBytes, 7)
    const tail = Buffer.from('合成尾片')
    const headChecksum = digest(full)
    const tailChecksum = digest(tail)
    const manifest = [headChecksum, tailChecksum]
    const payload = {
      requestId: randomUUID(),
      fileName: 'resume.apk',
      sizeBytes: full.length + tail.length,
      manifest,
    }
    const started = await api(fixture, scope.path, admin, 201, payload)
    const id = started.id
    assert.equal(started.status, 'receiving')
    assert.deepEqual(Object.keys(started).sort(), [
      'createdAt',
      'expiresAt',
      'fileName',
      'id',
      'sizeBytes',
      'status',
    ])
    assert.equal((await api(fixture, scope.path, admin, 201, payload)).id, id)
    await api(fixture, scope.path, admin, 400, {
      ...payload,
      requestId: randomUUID(),
      sizeBytes: limits.maxBytes + 1,
    })
    await api(fixture, scope.path, admin, 400, {
      ...payload,
      requestId: randomUUID(),
      objectKey: 'untrusted',
    })
    const target = scope.path + '/' + id
    await api(fixture, outsider.path + '/' + id + '/part', other, 404, { part: 1 })
    await api(fixture, target + '/part', other, 404, { part: 1 })

    await t.test('慢速首片、错误大小和摘要、只补缺片、按版本下载', async () => {
      await api(fixture, target + '/complete', admin, 409, {})
      const first = await api(fixture, target + '/part', admin, 200, { part: 1 })
      await slowPut(first.url, full, headChecksum)
      const progress = await api(fixture, target + '/resume', admin, 200, { manifest })
      assert.deepEqual(progress.completedParts, [1])
      await api(fixture, target + '/resume', admin, 409, { manifest: [manifest[0], manifest[0]] })
      const last = await api(fixture, target + '/part', admin, 200, { part: 2 })
      const wrongLength = await put(last.url, tail.subarray(0, tail.length - 1), tailChecksum)
      assert.ok(wrongLength >= 400, '签发不能接受不同长度')
      assert.ok(
        (await put(last.url, Buffer.alloc(tail.length), tailChecksum)) >= 400,
        '签发不能接受同长不同内容',
      )
      assert.equal(await put(last.url, tail, tailChecksum), 200)
      const result = await api(fixture, target + '/complete', admin, 200, {})
      assert.equal(result.status, 'awaiting_check')
      assert.equal(
        (await api(fixture, target + '/complete', admin, 200, {})).status,
        'awaiting_check',
      )
      const signed = new URL((await api(fixture, target + '/download', admin, 200, {})).url)
      assert.ok(signed.searchParams.get('versionId'))
      assert.equal(signed.searchParams.get('X-Amz-Expires'), String(limits.downloadLinkSeconds))
      const download = await fetch(signed)
      assert.equal(download.status, 200)
      assert.deepEqual(Buffer.from(await download.arrayBuffer()), Buffer.concat([full, tail]))
      signed.search = ''
      const anonymous = await fetch(signed)
      assert.ok(anonymous.status >= 400)
      await anonymous.body?.cancel()
    })

    await t.test('完成回报中断后恢复同一版本，删除失败保留配额', async () => {
      const record = await api(fixture, scope.path, admin, 201, {
        requestId: randomUUID(),
        fileName: 'completion-recovery.apk',
        sizeBytes: tail.length,
        manifest: [tailChecksum],
      })
      const recordPath = scope.path + '/' + record.id
      const link = await api(fixture, recordPath + '/part', admin, 200, { part: 1 })
      assert.equal(await put(link.url, tail, tailChecksum), 200)

      // 存储真实完成后切断回报，数据库应回滚；再次显式核对只冻结已存在的版本。
      const complete = artifactStorage.complete.bind(artifactStorage)
      let completions = 0
      artifactStorage.complete = async (...args) => {
        completions++
        await complete(...args)
        throw new Error('合成完成回报中断')
      }
      try {
        await api(fixture, recordPath + '/complete', admin, 503, {})
        const before = await api(fixture, scope.path, admin, 200)
        assert.equal(
          before.items.find((item: { id: string }) => item.id === record.id).status,
          'receiving',
        )
        const recovered = await api(fixture, recordPath + '/complete', admin, 200, {})
        assert.equal(recovered.status, 'awaiting_check')
        assert.equal(completions, 1)
      } finally {
        artifactStorage.complete = complete
      }

      // 删除异常不能提前释放配额或改变接收事实；恢复存储后由明确请求清理。
      const remove = artifactStorage.remove.bind(artifactStorage)
      artifactStorage.remove = async () => {
        throw new Error('合成对象删除失败')
      }
      try {
        await api(fixture, recordPath + '/remove', admin, 503, {})
        const retained = await api(fixture, scope.path, admin, 200)
        assert.equal(retained.reservedBytes, payload.sizeBytes + tail.length)
        assert.equal(
          retained.items.find((item: { id: string }) => item.id === record.id).status,
          'awaiting_check',
        )
      } finally {
        artifactStorage.remove = remove
      }
      await api(fixture, recordPath + '/remove', admin, 200, {})
      assert.equal((await api(fixture, scope.path, admin, 200)).reservedBytes, payload.sizeBytes)
    })

    await t.test('操作员可签发，查看者只读，回收保留引用和配额', async () => {
      const ws = '/api/hosted/workspaces/' + fixture.first
      await api(fixture, ws + '/members', admin, 201, {
        subject: 'pilot-viewer',
        label: '试点查看者',
        role: 'viewer',
      })
      const viewer = await login(fixture, 'pilot-viewer')
      await api(fixture, scope.path, viewer, 200)
      await api(fixture, target + '/download', viewer, 403, {})
      const member = (await api(fixture, ws + '/members', admin, 200)).items.find(
        (item: { label: string }) => item.label === '试点查看者',
      )
      await api(fixture, ws + '/members/' + member.id, admin, 200, { role: 'operator' }, 'PATCH')
      await api(fixture, target + '/download', viewer, 200, {})
      await api(fixture, target + '/remove', viewer, 403, {})

      const hold = randomUUID()
      await fixture.pool.query('INSERT INTO rh_hosted.artifact_holds VALUES ($1,$2,$3,$4,$5)', [
        fixture.first,
        scope.projectId,
        scope.appId,
        id,
        hold,
      ])
      await fixture.pool.query(
        "UPDATE rh_hosted.artifacts SET received_at = now() - interval '31 days' WHERE id = $1",
        [id],
      )
      await api(fixture, target + '/remove', admin, 409, {})
      assert.equal(await sweepHostedArtifacts(fixture.pool, artifactStorage), 0)
      assert.equal((await api(fixture, scope.path, admin, 200)).reservedBytes, payload.sizeBytes)
      await fixture.pool.query('DELETE FROM rh_hosted.artifact_holds WHERE hold_id = $1', [hold])
      const download = await api(fixture, target + '/download', admin, 200, {})
      assert.equal(await sweepHostedArtifacts(fixture.pool, artifactStorage), 0)
      const response = await fetch(download.url)
      assert.equal(response.status, 404)
      await response.body?.cancel()
      assert.equal((await api(fixture, scope.path, admin, 200)).reservedBytes, 0)
    })

    await t.test('并发预留上限、256 MiB 真上传、过期停止签发与回收', async () => {
      const sizeBytes = limits.maxBytes
      const checksum = digest(full)
      const maxManifest = Array.from({ length: limits.maxBytes / limits.partBytes }, () => checksum)
      const reserve = () =>
        api(fixture, scope.path, admin, [201, 409], {
          requestId: randomUUID(),
          fileName: 'max.apk',
          sizeBytes,
          manifest: maxManifest,
        })
      const allocated = await Promise.all(Array.from({ length: 9 }, reserve))
      const records = allocated.filter((item) => item.status === 'receiving')
      assert.equal(records.length, 8)
      assert.equal(
        (await api(fixture, scope.path, admin, 200)).reservedBytes,
        limits.workspaceBytes,
      )
      const firstRecord = records[0]
      assert.ok(firstRecord)
      const recordPath = scope.path + '/' + firstRecord.id
      for (const [index, sha256] of maxManifest.entries()) {
        const link = await api(fixture, recordPath + '/part', admin, 200, { part: index + 1 })
        assert.equal(await put(link.url, full, sha256), 200)
      }
      assert.equal(
        (await api(fixture, recordPath + '/complete', admin, 200, {})).sizeBytes,
        sizeBytes,
      )
      await api(fixture, recordPath + '/remove', admin, 200, {})
      for (const record of records.slice(1, -1))
        await api(fixture, scope.path + '/' + record.id + '/cancel', admin, 200, {})
      const expired = records.at(-1)
      assert.ok(expired)
      await fixture.pool.query(
        "UPDATE rh_hosted.artifacts SET expires_at = now() - interval '1 minute' WHERE id = $1",
        [expired.id],
      )
      await api(fixture, scope.path + '/' + expired.id + '/part', admin, 409, { part: 1 })
      assert.equal(await sweepHostedArtifacts(fixture.pool, artifactStorage), 0)
      assert.equal((await api(fixture, scope.path, admin, 200)).reservedBytes, 0)
    })

    if (browserEnabled)
      await t.test('Chrome 刷新后补传缺片，窄屏显示待检查', () =>
        browserResume(fixture, t, full, tail),
      )
  },
)

async function login(fixture: Fixture, identity: string): Promise<string> {
  const response = await fixture.request('/api/hosted/auth/start', {
    method: 'POST',
    headers: {
      Origin: fixture.origin,
      'X-Release-Harbor-Hosted': '1',
      'Content-Type': 'application/json',
    },
    body: '{}',
  })
  assert.equal(response.status, 200)
  const flow = response.headers.getSetCookie()[0]?.split(';')[0]
  assert.ok(flow)
  const target = new URL((await response.json()).url)
  target.searchParams.set('identity', identity)
  const callback = (await fetch(target, { redirect: 'manual' })).headers.get('location')
  assert.ok(callback)
  const result = await fixture.request(callback, { headers: { Cookie: flow } })
  const session = result.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith('__Host-rh-hosted-session='))
    ?.split(';')[0]
  assert.ok(session)
  return session
}

async function api(
  fixture: Fixture,
  path: string,
  session: string,
  status: number | number[],
  body?: object,
  method = body ? 'POST' : 'GET',
) {
  const response = await fixture.request(path, {
    method,
    headers: {
      Cookie: session,
      ...(body
        ? {
            Origin: fixture.origin,
            'X-Release-Harbor-Hosted': '1',
            'Content-Type': 'application/json',
          }
        : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json()
  assert.ok(
    [status].flat().includes(response.status),
    JSON.stringify({ path, status: response.status, message: data.message }),
  )
  return data
}

async function appPath(fixture: Fixture, workspace: string, session: string) {
  const projects = '/api/hosted/workspaces/' + workspace + '/projects'
  const project = await api(fixture, projects, session, 201, {
    name: '安装包测试',
    key: 'artifact-check',
    framework: 'native',
  })
  const apps = projects + '/' + project.id + '/applications'
  const app = await api(fixture, apps, session, 201, {
    name: '合成 Android',
    platform: 'android',
    identifier: 'com.harbor.artifacttest',
  })
  return { projectId: project.id, appId: app.id, path: apps + '/' + app.id + '/artifacts' }
}

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('base64')
}

async function put(url: string, bytes: Buffer, checksum: string): Promise<number> {
  const result = await fetch(url, {
    method: 'PUT',
    headers: { 'x-amz-checksum-sha256': checksum },
    body: new Uint8Array(bytes),
  })
  await result.body?.cancel()
  return result.status
}

async function slowPut(url: string, bytes: Buffer, checksum: string) {
  let send: ReturnType<typeof httpsRequest> | undefined
  const result = new Promise<number>((resolve, reject) => {
    send = httpsRequest(
      url,
      {
        method: 'PUT',
        headers: { 'Content-Length': bytes.length, 'x-amz-checksum-sha256': checksum },
      },
      (response) => {
        response.resume()
        response.on('end', () => resolve(response.statusCode ?? 0))
      },
    )
    send.on('error', reject)
  })
  for (let offset = 0; offset < bytes.length; offset += 1024 * 1024) {
    send?.write(bytes.subarray(offset, offset + 1024 * 1024))
    await delay(130)
  }
  send?.end()
  assert.equal(await result, 200)
}

async function browserResume(fixture: Fixture, t: TestContext, full: Buffer, tail: Buffer) {
  const browser = await chromium.launch({ channel: 'chrome' })
  t.after(() => browser.close())
  const page = await browser.newPage({
    ignoreHTTPSErrors: true,
    viewport: { width: 375, height: 812 },
  })
  page.setDefaultTimeout(12000)
  const uploads: number[] = []
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route(
    (url) => url.searchParams.has('partNumber'),
    async (route) => {
      if (route.request().method() !== 'PUT') return route.continue()
      const part = Number(new URL(route.request().url()).searchParams.get('partNumber'))
      uploads.push(part)
      if (part === 2 && uploads.length === 2) await route.abort()
      else await route.continue()
    },
  )
  const file = {
    name: 'browser-resume.apk',
    mimeType: 'application/vnd.android.package-archive',
    buffer: Buffer.concat([full, tail]),
  }
  await page.goto(fixture.origin)
  await page.getByRole('button', { name: '使用组织身份登录' }).click()
  await page.getByRole('link', { name: 'pilot-admin', exact: true }).click()
  await page.getByRole('button', { name: '安装包', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles(file)
  await page.getByRole('button', { name: '开始上传', exact: true }).click()
  await page.getByText('上传未完成', { exact: true }).waitFor()
  assert.deepEqual(uploads, [1, 2])
  await page.reload()
  await page.getByRole('button', { name: '安装包', exact: true }).click()
  const row = page.getByRole('listitem').filter({ hasText: 'browser-resume.apk' })
  await row.getByRole('button', { name: '继续上传', exact: true }).click()
  assert.deepEqual(uploads, [1, 2])
  await page.locator('input[type=file]').setInputFiles(file)
  await page.getByRole('button', { name: '开始续传', exact: true }).click()
  await row.getByText('待检查', { exact: true }).waitFor()
  assert.deepEqual(uploads, [1, 2, 2])
  assert.deepEqual(errors, [])
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.screenshot({ path: 'artifacts/hosted-artifacts-mobile.png' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.screenshot({ path: 'artifacts/hosted-artifacts-desktop.png' })
  const download = page.waitForEvent('download')
  await row.getByRole('button', { name: '下载', exact: true }).click()
  assert.equal((await download).suggestedFilename(), 'release.apk')
  await row.getByRole('button', { name: '清理原文件', exact: true }).click()
  await page.getByRole('button', { name: '清理', exact: true }).click()
  await row.getByText('原文件已清理', { exact: true }).waitFor()
  await page.close()
}
