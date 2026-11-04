/** @description 小米测试共用的公开 PNG 和内存合成材料；永不使用真实商店凭据。 */
import { createHash, generateKeyPairSync } from 'node:crypto'
import type { XiaomiUpdateDetails } from '../../packages/contracts/src/index.ts'

/** 1px PNG 仅作为完整编码及摘要边界夹具，不代表通过商店图标质量要求。 */
export const xiaomiIcon = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
  'base64',
)
/** 确定的非秘密更新资料。 */
export const xiaomiDetails: XiaomiUpdateDetails = {
  appName: '小米测试应用',
  privacyUrl: 'https://example.com/privacy',
  iconBase64: xiaomiIcon.toString('base64'),
  iconSha256: createHash('sha256').update(xiaomiIcon).digest('hex'),
}
/** 临时生成的 RSA key 只供解密断言，绝不持久化或输出。 */
export function xiaomiCredentials() {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const credentials = {
    userName: 'synthetic@example.com',
    privateKey: 'synthetic-xiaomi-access',
    publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    testAccountJson: JSON.stringify({
      zh_CN: {
        accounts: [{ t: 1, a: 'synthetic-login', p: 'synthetic-login-secret' }],
        auditNotes: '合成材料，不可用于真实商店',
      },
    }),
  }
  return { pair, credentials }
}
