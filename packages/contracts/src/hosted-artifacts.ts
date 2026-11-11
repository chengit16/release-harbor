/** @description 在线安装包的安全投影，不包含内部对象位置、分片清单或执行资格。 */
import { isRecord } from './applications.ts'
import { artifactLimits } from './artifacts.ts'

/** 接收边界；分片和文件大小为字节，时限为秒。 */
export const hostedArtifactLimits = {
  partBytes: 8 * 1024 * 1024,
  maxBytes: artifactLimits.maxFileBytes,
  workspaceBytes: artifactLimits.storageBudgetBytes,
  uploadSeconds: 24 * 60 * 60,
  retentionSeconds: 30 * 24 * 60 * 60,
  partLinkSeconds: 5 * 60,
  downloadLinkSeconds: 2 * 60,
} as const

/** 在线接收状态。待检查仅表示固定版本和大小已读回。 */
export type HostedArtifactStatus = 'receiving' | 'awaiting_check' | 'cancelled' | 'removed'

/** 浏览器读取的当前应用安装包记录。 */
export interface HostedArtifact {
  /** 服务端生成的产物定位标识。 */
  id: string
  /** 仅显示，不作为对象位置。 */
  fileName: string
  /** 预留字节数，待检查时等于读回的真实对象大小。 */
  sizeBytes: number
  /** 未包含可信包身份和发布资格的接收状态。 */
  status: HostedArtifactStatus
  /** ISO 8601 UTC 创建时刻。 */
  createdAt: string
  /** ISO 8601 UTC 接收绝对期限；只对接收中记录适用。 */
  expiresAt: string
}

/** 当前空间配额统计和应用的记录；配置缺失时仍可看已有记录。 */
export interface HostedArtifactList {
  /** 当前应用最近的接收记录。 */
  items: HostedArtifact[]
  /** 接收中及已接收未清理的空间占用，单位字节。 */
  reservedBytes: number
  /** 是否配置并验证了在线对象存储。 */
  enabled: boolean
}

/** 只在显式签发响应中出现的短时 HTTPS 能力。 */
export interface HostedArtifactLink {
  /** 不应持久化的限定对象或分片地址。 */
  url: string
}

/** 按固定片长和实际尾片计算字节数；调用方须先验证片号。 */
export function hostedPartBytes(fileBytes: number, part: number): number {
  return Math.min(
    hostedArtifactLimits.partBytes,
    fileBytes - (part - 1) * hostedArtifactLimits.partBytes,
  )
}

/** 在线目录响应守卫；不把服务端记录误认作本地已检查安装包。 */
export function isHostedArtifact(value: unknown): value is HostedArtifact {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.fileName === 'string' &&
    Number.isSafeInteger(value.sizeBytes) &&
    ['receiving', 'awaiting_check', 'cancelled', 'removed'].some(
      (status) => status === value.status,
    ) &&
    typeof value.createdAt === 'string' &&
    typeof value.expiresAt === 'string'
  )
}
