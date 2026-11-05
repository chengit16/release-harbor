/** @description 应用宝／鸿蒙合成公开来源与内存材料，禁止使用真实账号或商店流量。 */
import { createHash } from 'node:crypto'
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
const publicFields = { appName: '合成应用', sourceVersionName: '0.0.1', sourceVersionCode: '1' }
export const tencentDetails = { ...publicFields, publicDigest: digest(publicFields) }
const harmonyFields = { ...publicFields, defaultLang: 'zh-CN' }
export const harmonyDetails = { ...harmonyFields, publicDigest: digest(harmonyFields) }
export const tencentCredentials = { userId: '12345', accessSecret: 'SYNTHETIC-TENCENT-SECRET' }
export const harmonyCredentials = {
  clientId: 'synthetic-harmony-client',
  clientSecret: 'SYNTHETIC-HARMONY-SECRET',
}
