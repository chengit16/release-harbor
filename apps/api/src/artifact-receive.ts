/** @description 有界原始字节接收，逐块写盘并计算摘要，不把安装包整体载入 API 内存。 */
import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'
import type { Readable } from 'node:stream'
import {
  artifactFailureMessages,
  artifactLimits,
  type ArtifactFailureCode,
} from '@release-harbor/contracts'
import { DomainError } from '@release-harbor/domain'

/** 携带可持久化失败分类，公开响应始终使用安全文案。 */
export class ArtifactReceiveError extends DomainError {
  constructor(
    readonly failureCode: ArtifactFailureCode,
    statusCode = 400,
  ) {
    super(artifactFailureMessages[failureCode], statusCode)
  }
}

/** 边接收边核对长度，失败交由服务清理字节并保存失败记录。 */
export async function receiveArtifact(
  stream: Readable,
  partial: string,
  expectedSize: number,
): Promise<{ sizeBytes: number; sha256: string }> {
  const file = await open(partial, 'wx', 0o600).catch(() => {
    throw new ArtifactReceiveError('storage_failed', 507)
  })
  const hash = createHash('sha256')
  let sizeBytes = 0
  const timeout = setTimeout(
    () => stream.destroy(new ArtifactReceiveError('upload_timeout', 408)),
    artifactLimits.uploadTimeoutMs,
  )
  try {
    // 1. 声明长度不构成信任，逐块计数；不完整流绝不能进入 checking。
    for await (const chunk of stream.iterator({ destroyOnReturn: false })) {
      if (!Buffer.isBuffer(chunk)) throw new ArtifactReceiveError('upload_incomplete')
      sizeBytes += chunk.length
      if (sizeBytes > artifactLimits.maxFileBytes)
        throw new ArtifactReceiveError('upload_too_large', 413)
      if (sizeBytes > expectedSize) throw new ArtifactReceiveError('upload_incomplete')
      // 2. 文件写入可能只完成部分字节，推进偏移直到整块完成再更新摘要。
      for (let offset = 0; offset < chunk.length; ) {
        const result = await file.write(chunk, offset, chunk.length - offset, null).catch(() => {
          throw new ArtifactReceiveError('storage_failed', 507)
        })
        if (result.bytesWritten < 1) throw new ArtifactReceiveError('storage_failed', 507)
        offset += result.bytesWritten
      }
      hash.update(chunk)
    }
    // 3. 完整接收后同步文件，避免仅因上传连接结束就宣称已持久保存。
    if (sizeBytes !== expectedSize) throw new ArtifactReceiveError('upload_incomplete')
    await file.sync().catch(() => {
      throw new ArtifactReceiveError('storage_failed', 507)
    })
    return { sizeBytes, sha256: hash.digest('hex') }
  } catch (error) {
    if (error instanceof ArtifactReceiveError) throw error
    throw new ArtifactReceiveError('upload_incomplete')
  } finally {
    clearTimeout(timeout)
    await file.close()
    if (!stream.destroyed) stream.resume()
  }
}
