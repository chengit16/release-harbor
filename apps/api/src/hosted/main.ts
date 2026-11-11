/** @description 启动独立的在线目录验证宿主；环境未就绪时拒绝启动且不回退到本机模式。 */
import { fileURLToPath } from 'node:url'
import { createHostedApp } from './app.ts'
import { hostedConfig, requiredEnv } from './config.ts'
import { assertHostedSchema, hostedPool } from './database.ts'
import { createHostedLogin } from './oidc.ts'
import { hostedStorageConfig } from './artifacts/config.ts'
import { HostedArtifactStorage } from './artifacts/storage.ts'
import { startHostedArtifactSweep } from './artifacts/sweep.ts'

async function main() {
  const config = hostedConfig()
  const storageConfig = hostedStorageConfig()
  const storage = storageConfig ? new HostedArtifactStorage(storageConfig) : undefined
  const pool = hostedPool(requiredEnv('RELEASE_HARBOR_HOSTED_DATABASE_URL'))
  try {
    await assertHostedSchema(pool)
    await storage?.verify()
    const login = await createHostedLogin(config.oidc)
    const app = await createHostedApp({
      pool,
      origin: config.origin,
      login,
      artifactStorage: storage,
      webRoot: fileURLToPath(new URL('../../../web/hosted/dist/', import.meta.url)),
    })
    try {
      await app.listen(config.port, '127.0.0.1')
    } catch (error) {
      await app.close()
      throw error
    }
    const stopSweep = storage ? startHostedArtifactSweep(pool, storage) : undefined
    const close = async () => {
      try {
        await app.close()
      } finally {
        await stopSweep?.()
        storage?.close()
        await pool.end()
      }
    }
    for (const signal of ['SIGINT', 'SIGTERM'] as const)
      process.once(signal, () => {
        void close().catch(() => {
          process.exitCode = 1
        })
      })
    console.log(`在线目录验证宿主已在回环端口 ${config.port} 启动；发布尚未开放。`)
  } catch {
    storage?.close()
    await pool.end()
    throw new Error('在线验证宿主无法启动；请核对数据库迁移、OIDC、Web 构建与回环端口')
  }
}

void main().catch(() => {
  console.error(
    '在线验证宿主未启动；请核对必需环境变量、数据库迁移、OIDC、对象存储、Web 构建与端口',
  )
  process.exitCode = 1
})
