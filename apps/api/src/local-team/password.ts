/** @description 本机账号口令校验与摘要；服务只持久化独立随机盐及 scrypt 摘要。 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { DomainError } from '@release-harbor/domain'

/** 已持久化口令摘要；客户端不得接收此结构。 */
export interface TeamPassword {
  salt: string
  hash: string
}

/** 初次创建和修改使用同一限制，限制长度也避免超大输入参与派生。 */
export function newPassword(value: unknown): string {
  if (!validPassword(value)) throw new DomainError('密码须为 12 至 128 字节且不含控制字符')
  return value
}

/** 登录使用同一输入边界，但由服务统一给出失败反馈。 */
export function validPassword(value: unknown): value is string {
  if (typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value)) return false
  const bytes = Buffer.byteLength(value)
  return bytes >= 12 && bytes <= 128
}

/** 为每份口令生成独立随机盐，派生异步执行以避免阻塞 HTTP 主线程。 */
export async function hashTeamPassword(value: string): Promise<TeamPassword> {
  const salt = randomBytes(24).toString('hex')
  return { salt, hash: (await derive(value, salt)).toString('hex') }
}

/** 比较固定长度摘要；未知用户也走同一派生路径。 */
export async function verifyTeamPassword(value: string, expected: TeamPassword): Promise<boolean> {
  return timingSafeEqual(await derive(value, expected.salt), Buffer.from(expected.hash, 'hex'))
}

function derive(value: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      value,
      Buffer.from(salt, 'hex'),
      64,
      { N: 32768, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    )
  })
}
