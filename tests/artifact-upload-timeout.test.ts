/** @description 慢速安装包接收的超时回归；使用虚拟时钟和临时字节文件，不访问真实产物或商店。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import { PassThrough } from 'node:stream'
import { ArtifactReceiveError, receiveArtifact } from '../apps/api/src/artifact-receive.ts'
import { artifactLimits } from '../packages/contracts/src/artifacts.ts'

/** 等待磁盘写入及进度计时器更新，避免虚拟时钟先于真实文件 I/O 推进。 */
async function waitForSize(path: string, expected: number): Promise<void> {
  for (let n = 0; n < 100; n++) {
    if ((await stat(path).catch(() => null))?.size === expected) {
      await setImmediate()
      return
    }
    await setImmediate()
  }
  assert.fail('接收流未及时写入预期字节')
}

test('持续有进度的上传超过原两分钟总时限后仍能完整保存并核对摘要', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'harbor-upload-timeout-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const path = join(root, 'partial'),
    stream = new PassThrough(),
    bytes = Buffer.from('synthetic-slow-upload')
  const receiving = receiveArtifact(stream, path, bytes.length)
  // 先观察拒绝，避免虚拟时钟触发超时时产生未处理 Promise；末尾仍断言真实结果。
  void receiving.catch(() => undefined)
  t.after(() => stream.destroy())
  stream.write(bytes.subarray(0, 5))
  await waitForSize(path, 5)
  t.mock.timers.tick(60000)
  stream.write(bytes.subarray(5, 10))
  await waitForSize(path, 10)
  t.mock.timers.tick(60001)
  stream.end(bytes.subarray(10))
  const result = await receiving
  assert.equal(result.sizeBytes, bytes.length)
  assert.equal(result.sha256, createHash('sha256').update(bytes).digest('hex'))
  assert.deepEqual(await readFile(path), bytes)
})

for (const started of [false, true]) {
  test(`${started ? '已有进度后停滞' : '连接后一直没有数据'}达到空闲上限仍会停止接收`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'harbor-upload-idle-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const timers = t.mock.method(globalThis, 'setTimeout')
    const path = join(root, 'partial')
    const stream = new PassThrough()
    t.after(() => stream.destroy())
    const receiving = receiveArtifact(stream, path, 100)
    const rejected = assert.rejects(receiving, (error: unknown) => {
      assert.ok(error instanceof ArtifactReceiveError)
      assert.equal(error.failureCode, 'upload_timeout')
      assert.equal(error.statusCode, 408)
      return true
    })
    if (started) stream.write(Buffer.from('partial'))
    await waitForSize(path, started ? 7 : 0)
    // 空文件创建可能早于 open() 返回；确认两个计时器已安装再模拟无数据等待。
    for (let n = 0; n < 100 && timers.mock.callCount() < 2; n++) await setImmediate()
    assert.ok(timers.mock.callCount() >= 2, '接收计时器应在文件打开后及时启动')
    t.mock.timers.tick(artifactLimits.uploadIdleTimeoutMs - 1)
    assert.equal(stream.destroyed, false)
    t.mock.timers.tick(1)
    await rejected
    assert.equal(stream.destroyed, true)
  })
}

test('持续传输不能延长绝对总时限', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'harbor-upload-total-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const path = join(root, 'partial')
  const stream = new PassThrough()
  t.after(() => stream.destroy())
  const receiving = receiveArtifact(stream, path, 10000)
  const rejected = assert.rejects(receiving, (error: unknown) => {
    assert.ok(error instanceof ArtifactReceiveError)
    assert.equal(error.failureCode, 'upload_timeout')
    return true
  })
  // 每分钟有真实写入，因此只有绝对总时限可以终止该连接。
  for (let elapsed = 0, size = 0; elapsed < artifactLimits.uploadTimeoutMs; elapsed += 60000) {
    stream.write(Buffer.from('x'))
    await waitForSize(path, ++size)
    assert.equal(stream.destroyed, false)
    t.mock.timers.tick(60000)
  }
  await rejected
  assert.equal(stream.destroyed, true)
})
