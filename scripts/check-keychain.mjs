/** @description 手动验证原生 Keychain 的长凭据与 SDK 加密兼容性，只创建随机服务的合成数据并清理。 */
import assert from 'node:assert/strict'
import { randomUUID, generateKeyPairSync } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NativeKeychainSecrets } from '../packages/provider-app-ship/src/keychain.ts'
import { credentialStore } from '../packages/provider-app-ship/src/credentials.ts'

if (process.platform !== 'darwin') throw new Error('此检查仅支持 macOS')
const root = await mkdtemp(join(tmpdir(), 'harbor-keychain-check-'))
const secrets = new NativeKeychainSecrets('release-harbor-check-' + randomUUID())
const store = credentialStore(join(root, 'profiles.json'), secrets)
const refs = ['synthetic-huawei', 'synthetic-apple']
try {
  // 1. 超过 SDK 交互密码提示和 security -i 行长的材料不得被截断或转义破坏。
  const fields = { clientId: 'x'.repeat(4096), clientSecret: '测试"\\$`'.repeat(600) }
  await store.saveProfile({ credentialProfile: refs[0], platform: 'huawei', material: { fields } })
  const huawei = await store.resolveForLocalExecution({
    credentialProfile: refs[0],
    platform: 'huawei',
    purpose: 'verify',
  })
  assert.deepEqual(huawei.fields, fields)
  // 2. 同一安全库同时承载标量和加密文件的主密钥，验证 Apple 文件可完整解密。
  const content = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString()
  await store.saveProfile({
    credentialProfile: refs[1],
    platform: 'app_store',
    material: {
      fields: { apiIssuerId: '11111111-1111-4111-8111-111111111111', apiKeyId: 'ABCDEFGHIJ' },
      files: { privateKey: { content } },
    },
  })
  const apple = await store.resolveForLocalExecution({
    credentialProfile: refs[1],
    platform: 'app_store',
    purpose: 'verify',
  })
  assert.equal(apple.files.privateKey.content, content)
  console.log(
    '原生安全库存储验证通过：长输入、中文和特殊字符、Apple 加密文件完整读回；未访问商店。',
  )
} finally {
  // 3. 只清理本脚本随机服务中的账号与主密钥，绝不操作用户的 release-harbor 服务。
  const cleanup = await Promise.allSettled(
    [...refs, '__vault_master_key_v1__'].map((ref) => secrets.deleteSecret(ref)),
  )
  await rm(root, { recursive: true, force: true })
  assert.ok(
    cleanup.every((r) => r.status === 'fulfilled'),
    '隔离安全库清理失败',
  )
}
