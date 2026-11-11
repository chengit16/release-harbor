/** @description 在线对象存储边界；传输只使用服务端生成的位置，浏览器不接触云账号。 */
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetBucketVersioningCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { DomainError } from '@release-harbor/domain'
import { hostedArtifactLimits } from '@release-harbor/contracts'

/** 存储报告的实际分片，摘要是该片 SHA-256，不是整包摘要。 */
export interface HostedStoredPart {
  /** 从 1 开始的片号。 */
  number: number
  /** 存储接收的字节数。 */
  bytes: number
  /** 服务端用于提交同一片的存储 ETag。 */
  etag: string
  /** S3 验证并返回的 Base64 SHA-256。 */
  checksum: string
}

/** 读回的对象事实，缺版本或接收标记不可接受。 */
export interface HostedObject {
  /** 对象实际大小。 */
  bytes: number | undefined
  /** 唯一的对象版本；`null` 不是可冻结版本。 */
  version: string | undefined
  /** 开始接收时由控制面写入的产物 ID。 */
  marker: string | undefined
}

/** 固定 HTTPS 桶配置，不能来自公开请求。 */
export interface HostedStorageConfig {
  /** 浏览器和服务端均可访问的固定 HTTPS S3 来源。 */
  endpoint: URL
  /** 专用于当前环境的版本化私有桶。 */
  bucket: string
  /** 签名区域。 */
  region: string
  /** 后端专用访问标识。 */
  accessKeyId: string
  /** 后端专用访问密钥。 */
  secretAccessKey: string
}

/** 仅处理固定对象的 multipart 和版本操作；适配层不接收或转发包字节。 */
export class HostedArtifactStorage {
  readonly origin: string
  private readonly s3: S3Client

  constructor(private readonly config: HostedStorageConfig) {
    this.origin = config.endpoint.origin
    this.s3 = new S3Client({
      endpoint: config.endpoint.href,
      region: config.region,
      forcePathStyle: true,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      maxAttempts: 1,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    })
  }

  /** 启用前要求桶版本控制已打开；暂停版本控制也视为不可用。 */
  async verify(): Promise<void> {
    const result = await this.s3.send(
      new GetBucketVersioningCommand({ Bucket: this.config.bucket }),
      deadline(),
    )
    if (result.Status !== 'Enabled') throw new Error('在线安装包需要开启对象版本控制')
  }

  /** 关闭空闲存储连接。 */
  close(): void {
    this.s3.destroy()
  }

  /** 按私有对象位置建立 SHA-256 分片上传。 */
  async open(key: string, artifactId: string): Promise<string> {
    const result = await this.s3.send(
      new CreateMultipartUploadCommand({
        ...this.target(key),
        ChecksumAlgorithm: 'SHA256',
        ContentType: 'application/octet-stream',
        Metadata: { 'harbor-artifact': artifactId },
      }),
      deadline(),
    )
    if (!result.UploadId) throw unavailable()
    return result.UploadId
  }

  /** 签名覆盖片号、上传 ID、内容长度和 SHA-256；浏览器由 Blob 自动提供长度。 */
  async partLink(
    key: string,
    uploadId: string,
    part: number,
    bytes: number,
    checksum: string,
    seconds: number,
  ): Promise<string> {
    const url = await getSignedUrl(
      this.s3,
      new UploadPartCommand({
        ...this.target(key),
        UploadId: uploadId,
        PartNumber: part,
        ContentLength: bytes,
        ChecksumSHA256: checksum,
      }),
      {
        expiresIn: seconds,
        signableHeaders: new Set(['content-length', 'x-amz-checksum-sha256']),
        unhoistableHeaders: new Set(['x-amz-checksum-sha256']),
      },
    )
    const parsed = new URL(url)
    const signed = parsed.searchParams.get('X-Amz-SignedHeaders')?.split(';')
    if (
      parsed.origin !== this.origin ||
      !signed?.includes('content-length') ||
      !signed.includes('x-amz-checksum-sha256')
    )
      throw unavailable()
    return url
  }

  /** 读取真实已存分片；没有任何浏览器 ETag 被用于完成。 */
  async parts(key: string, uploadId: string): Promise<HostedStoredPart[]> {
    const result = await this.s3.send(
      new ListPartsCommand({ ...this.target(key), UploadId: uploadId }),
      deadline(),
    )
    if (result.IsTruncated) throw unavailable()
    return (result.Parts ?? []).map((part) => {
      if (!part.PartNumber || part.Size === undefined || !part.ETag || !part.ChecksumSHA256)
        throw new DomainError('对象存储无法证明已接收分片，请取消或稍后核对', 409)
      return {
        number: part.PartNumber,
        bytes: part.Size,
        etag: part.ETag,
        checksum: part.ChecksumSHA256,
      }
    })
  }

  /** 使用服务端核对过的分片完成；已有同键对象时拒绝覆盖。 */
  async complete(
    key: string,
    uploadId: string,
    parts: HostedStoredPart[],
  ): Promise<string | undefined> {
    const result = await this.s3.send(
      new CompleteMultipartUploadCommand({
        ...this.target(key),
        UploadId: uploadId,
        IfNoneMatch: '*',
        MultipartUpload: {
          Parts: parts.map((part) => ({
            PartNumber: part.number,
            ETag: part.etag,
            ChecksumSHA256: part.checksum,
          })),
        },
      }),
      deadline(),
    )
    return result.VersionId
  }

  /** 读取指定版本；只有对象明确不存在才返回空，其他错误保持待核对。 */
  async head(key: string, version?: string): Promise<HostedObject | undefined> {
    try {
      const result = await this.s3.send(
        new HeadObjectCommand({ ...this.target(key), VersionId: version }),
        deadline(),
      )
      return {
        version: result.VersionId,
        bytes: result.ContentLength,
        marker: result.Metadata?.['harbor-artifact'],
      }
    } catch (error) {
      if (storageStatus(error) === 404) return undefined
      throw error
    }
  }

  /** 取消精确的 multipart 上传；已经不存在视为重复取消。 */
  async abort(key: string, uploadId: string): Promise<void> {
    try {
      await this.s3.send(
        new AbortMultipartUploadCommand({ ...this.target(key), UploadId: uploadId }),
        deadline(),
      )
    } catch (error) {
      if (storageStatus(error) !== 404) throw error
    }
    // 分片可能在取消时仍在传输；只有上传会话确实消失才允许释放配额。
    try {
      await this.s3.send(
        new ListPartsCommand({ ...this.target(key), UploadId: uploadId }),
        deadline(),
      )
    } catch (error) {
      if (storageStatus(error) === 404) return
      throw error
    }
    throw new DomainError('分片上传尚未完全取消，请稍后重试', 409)
  }

  /** 生成限定版本的短时附件下载，不回退到当前最新版本。 */
  async download(key: string, version: string): Promise<string> {
    const url = await getSignedUrl(
      this.s3,
      new GetObjectCommand({
        ...this.target(key),
        VersionId: version,
        ResponseContentDisposition: 'attachment; filename="release.apk"',
      }),
      { expiresIn: hostedArtifactLimits.downloadLinkSeconds },
    )
    const parsed = new URL(url)
    if (parsed.origin !== this.origin || parsed.searchParams.get('versionId') !== version)
      throw unavailable()
    return url
  }

  /** 清理一个不可变版本；不使用会插入删除标记的无版本删除。 */
  async remove(key: string, version: string): Promise<void> {
    try {
      await this.s3.send(
        new DeleteObjectCommand({ ...this.target(key), VersionId: version }),
        deadline(),
      )
    } catch (error) {
      if (storageStatus(error) !== 404) throw error
    }
  }

  private target(key: string): { Bucket: string; Key: string } {
    return { Bucket: this.config.bucket, Key: key }
  }
}

/** 将 SDK 失败映射为固定提示，不暴露桶、连接地址、请求头或签名。 */
export async function storageCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (error) {
    if (error instanceof DomainError) throw error
    throw unavailable()
  }
}

function deadline(): { abortSignal: AbortSignal } {
  return { abortSignal: AbortSignal.timeout(7000) }
}

function storageStatus(error: unknown): unknown {
  if (!error || typeof error !== 'object' || !('$metadata' in error)) return
  const metadata = error.$metadata
  if (metadata && typeof metadata === 'object' && 'httpStatusCode' in metadata)
    return metadata.httpStatusCode
}

function unavailable(): DomainError {
  return new DomainError('对象存储暂不可用，请刷新记录后再试', 503)
}
