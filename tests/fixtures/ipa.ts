/** @description 仅含合成 plist 的 ZIP 测试样本，不是可安装、可签名或可发布的真实 IPA。 */
import { execFileSync } from 'node:child_process'

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** binary 为 true 时通过真实 plutil 生成二进制 plist，覆盖生产 IPA 常见格式，不接触账号。 */
export function syntheticIpa(identifier = 'com.example.ios', binary = false): Buffer {
  const name = Buffer.from('Payload/Synthetic.app/Info.plist')
  const xml = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${identifier}</string>
<key>CFBundleShortVersionString</key><string>1.2.3</string>
<key>CFBundleVersion</key><string>42</string></dict></plist>`)
  const content = binary
    ? execFileSync('plutil', ['-convert', 'binary1', '-o', '-', '-'], { input: xml, timeout: 5000 })
    : xml
  const checksum = crc32(content)
  // ZIP 的本地头、中央目录和尾记录共同保护真实解析，不用伪造检查结果替代样本字节。
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt32LE(checksum, 14)
  local.writeUInt32LE(content.length, 18)
  local.writeUInt32LE(content.length, 22)
  local.writeUInt16LE(name.length, 26)
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt32LE(checksum, 16)
  central.writeUInt32LE(content.length, 20)
  central.writeUInt32LE(content.length, 24)
  central.writeUInt16LE(name.length, 28)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(central.length + name.length, 12)
  end.writeUInt32LE(local.length + name.length + content.length, 16)
  return Buffer.concat([local, name, content, central, name, end])
}
