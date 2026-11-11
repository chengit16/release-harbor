/** @description 在线对象存储配置；整组缺省时保留在线目录，部分设置拒绝启动。 */
import { hostedOrigin, requiredEnv } from '../config.ts'
import type { HostedStorageConfig } from './storage.ts'

const vars = {
  endpoint: 'RELEASE_HARBOR_HOSTED_S3_ENDPOINT',
  bucket: 'RELEASE_HARBOR_HOSTED_S3_BUCKET',
  region: 'RELEASE_HARBOR_HOSTED_S3_REGION',
  accessKeyId: 'RELEASE_HARBOR_HOSTED_S3_ACCESS_KEY_ID',
  secretAccessKey: 'RELEASE_HARBOR_HOSTED_S3_SECRET_ACCESS_KEY',
} as const

/** 仅从服务端环境加载完整 HTTPS 私有桶配置。 */
export function hostedStorageConfig(): HostedStorageConfig | undefined {
  if (!Object.values(vars).some((key) => process.env[key] !== undefined)) return
  const bucket = requiredEnv(vars.bucket)
  const region = requiredEnv(vars.region)
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) || !/^[a-z0-9-]{1,50}$/.test(region))
    throw new Error('在线对象存储桶名或区域格式不正确')
  return {
    endpoint: hostedOrigin(requiredEnv(vars.endpoint)),
    bucket,
    region,
    accessKeyId: requiredEnv(vars.accessKeyId),
    secretAccessKey: requiredEnv(vars.secretAccessKey),
  }
}
