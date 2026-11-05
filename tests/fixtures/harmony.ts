/** @description 仅含合成 pack.info 的 ZIP 测试样本，不是可安装、可签名或可发布的正式 APP。 */

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** 通过真实 ZIP 字节覆盖 APP 身份解析，坏结构由参数提供，绝不使用真实安装包。 */
export function syntheticHarmony(
  identifier = 'com.example.harmony',
  pack: unknown = {
    summary: { app: { bundleName: identifier, version: { name: '1.2.3', code: 42 } } },
  },
  payloadBytes = 0,
): Buffer {
  const entries: [string, Buffer][] = [['pack.info', Buffer.from(JSON.stringify(pack))]]
  if (payloadBytes > 0) entries.push(['entry-default.hap', Buffer.alloc(payloadBytes, 31)])
  const locals: Buffer[] = [],
    centrals: Buffer[] = []
  let offset = 0
  // ZIP 本地条目与中央目录均有真实长度、偏移及 CRC，覆盖跨多个上传分片的 APP。
  for (const [path, content] of entries) {
    const name = Buffer.from(path),
      checksum = crc32(content),
      local = Buffer.alloc(30),
      central = Buffer.alloc(46)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(content.length, 18)
    local.writeUInt32LE(content.length, 22)
    local.writeUInt16LE(name.length, 26)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(content.length, 20)
    central.writeUInt32LE(content.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, name, content)
    centrals.push(central, name)
    offset += local.length + name.length + content.length
  }
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(
    centrals.reduce((n, b) => n + b.length, 0),
    12,
  )
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, ...centrals, end])
}
