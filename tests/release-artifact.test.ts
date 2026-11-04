/** @description 执行副本路径回归：系统临时目录经符号别名访问时，合法副本仍须核验，篡改产物不可进入商店流程。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { syntheticIpa } from './fixtures/ipa.ts'
import { withVerifiedReleaseArtifact } from '../packages/runner-local/src/release-artifact.ts'
import type { InspectionTask } from '../packages/runner-local/src/protocol.ts'

test('执行副本在非规范临时目录中仍通过真实检查；失败不进入后续操作且清理副本', async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'harbor-execution-copy-test-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const id = randomUUID()
  const original = join(root, 'artifacts')
  await mkdir(join(original, id), { recursive: true })
  const bytes = syntheticIpa('com.example.copy', true)
  await writeFile(join(original, id, 'payload.ipa'), bytes)
  const temporaryRoot = join(root, 'temporary')
  const alias = join(root, 'temporary-alias')
  await mkdir(temporaryRoot)
  await symlink(temporaryRoot, alias, 'dir')
  const inspection: InspectionTask = {
    schemaVersion: 1,
    action: 'inspect',
    nonce: 'a'.repeat(32),
    artifactId: id,
    storageRoot: original,
    format: 'ipa',
    sizeBytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    target: {
      workspaceId: 'local',
      projectId: randomUUID(),
      applicationId: randomUUID(),
      platform: 'ios',
      identifier: 'com.example.copy',
    },
  }
  const identity = {
    format: 'ipa',
    packageName: 'com.example.copy',
    versionName: '1.2.3',
    buildNumber: '42',
    sha256: inspection.sha256,
    sizeBytes: bytes.length,
  }
  let reached = 0
  const outcome = await withVerifiedReleaseArtifact(
    inspection,
    identity,
    async (file) => {
      reached++
      assert.equal(file, await realpath(file))
      assert.deepEqual(await readFile(file), bytes)
      return 'interrupted'
    },
    alias,
  )
  assert.equal(outcome, 'interrupted', '合法执行副本不应因临时目录别名误报复核失败')
  assert.equal(reached, 1)
  assert.deepEqual(await readdir(temporaryRoot), [])
  await writeFile(join(original, id, 'payload.ipa'), 'tampered')
  assert.equal(
    await withVerifiedReleaseArtifact(
      inspection,
      identity,
      async () => {
        throw new Error('篡改不能进入回调')
      },
      alias,
    ),
    'verification_failed',
  )
  assert.deepEqual(await readdir(temporaryRoot), [])
})
