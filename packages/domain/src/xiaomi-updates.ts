/** @description 小米公开资料的字节及摘要核对；只接收公开 PNG，不解密凭据或访问商店。 */
import { createHash } from 'node:crypto'
import { isXiaomiUpdateDetails, type XiaomiUpdateDetails } from '@release-harbor/contracts'
import { DomainError } from './errors.ts'

/** 创建和执行均重验，防止不同图标或无效编码沿用同一确认。 */
export function validateXiaomiUpdateDetails(value: unknown): XiaomiUpdateDetails {
  if (!isXiaomiUpdateDetails(value))
    throw new DomainError('请填写 HTTPS 隐私政策和不超过 256 KiB 的 PNG 图标')
  const data = Buffer.from(value.iconBase64, 'base64')
  if (
    data.length < 45 ||
    data.length > 256 * 1024 ||
    data.toString('base64') !== value.iconBase64 ||
    data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
    data.readUInt32BE(8) !== 13 ||
    data.toString('ascii', 12, 16) !== 'IHDR' ||
    !data.readUInt32BE(16) ||
    !data.readUInt32BE(20) ||
    data.readUInt32BE(16) > 2048 ||
    data.readUInt32BE(20) > 2048 ||
    data.subarray(-12).toString('hex') !== '0000000049454e44ae426082' ||
    createHash('sha256').update(data).digest('hex') !== value.iconSha256
  )
    throw new DomainError('PNG 图标格式、尺寸或摘要不正确，请重新选择图标')
  return structuredClone(value)
}
