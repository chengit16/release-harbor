/** @description 小米专用材料格式；访问密码与结构化测试账号只在可信进程解析，不返回公开字段。 */
import { createPublicKey, X509Certificate } from 'node:crypto'
import { isRecord } from '@release-harbor/contracts'

/** 公钥统一存为 SPKI PEM；拒绝私钥或非 RSA 材料，兼容平台 PEM 证书及裸 Base64。 */
export function normalizeXiaomiPublicKey(content: string): string {
  if (Buffer.byteLength(content) > 64 * 1024 || /PRIVATE KEY/.test(content))
    throw new Error('公钥格式错误')
  let key
  try {
    key = new X509Certificate(content).publicKey
  } catch {
    key = createPublicKey(
      content.includes('-----BEGIN')
        ? content
        : `-----BEGIN PUBLIC KEY-----\n${content.replace(/\s/g, '')}\n-----END PUBLIC KEY-----`,
    )
  }
  const bits = key.asymmetricKeyDetails?.modulusLength
  if (key.asymmetricKeyType !== 'rsa' || !bits || bits < 1024 || bits > 4096)
    throw new Error('公钥格式错误')
  return key.export({ type: 'spki', format: 'pem' }).toString()
}
/** 严格接受官方新版 zh_CN 结构；不接收旧字符串、路径或任意嵌套字段。 */
export function parseXiaomiTestAccount(raw: string): Record<string, unknown> {
  if (Buffer.byteLength(raw) > 4096) throw new Error('测试材料过长')
  const data: unknown = JSON.parse(raw)
  if (!isRecord(data) || Object.keys(data).length !== 1 || !isRecord(data.zh_CN))
    throw new Error('测试材料格式错误')
  const zh = data.zh_CN
  if (
    Object.keys(zh).some((k) => !['accounts', 'auditNotes'].includes(k)) ||
    typeof zh.auditNotes !== 'string' ||
    !zh.auditNotes.trim() ||
    zh.auditNotes.length > 500 ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(zh.auditNotes)
  )
    throw new Error('请填写审核说明')
  if (
    zh.accounts !== undefined &&
    (!Array.isArray(zh.accounts) ||
      zh.accounts.length > 5 ||
      !zh.accounts.every(
        (a) =>
          isRecord(a) &&
          Object.keys(a).every((k) => ['t', 'a', 'p', 'c'].includes(k)) &&
          (a.t === 1 || a.t === 2) &&
          typeof a.a === 'string' &&
          !!a.a.trim() &&
          a.a.length <= 50 &&
          typeof a.p === 'string' &&
          !!a.p.trim() &&
          a.p.length <= 50 &&
          (a.c === undefined || (typeof a.c === 'string' && a.c.length <= 50)) &&
          [a.a, a.p, a.c ?? ''].every((v) => typeof v === 'string' && !/[\x00-\x1f\x7f]/.test(v)),
      ))
  )
    throw new Error('测试账号格式错误')
  return data
}
