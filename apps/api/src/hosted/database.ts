/** @description 在线 PostgreSQL 连接和显式迁移；不访问本机数据根或在启动时改表。 */
import { readFile } from 'node:fs/promises'
import { Pool, type PoolClient } from 'pg'
import { DomainError } from '@release-harbor/domain'

/** 建立独立在线连接池，部署方负责配置受信任数据库端点与 TLS。 */
export function hostedPool(connectionString: string): Pool {
  const pool = new Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000 })
  // 连接详情可能包含敏感部署信息，空闲连接异常不透传原始错误。
  pool.on('error', () => console.error('在线数据库空闲连接断开'))
  return pool
}

/** 保证业务异常回滚，并将已知唯一性冲突映射为安全响应。 */
export async function transaction<T>(
  pool: Pool,
  run: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  let broken = false
  try {
    await client.query('BEGIN')
    const result = await run(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      broken = true
    }
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505')
      throw new DomainError('当前工作空间或目录中已有相同标识', 409)
    throw error
  } finally {
    client.release(broken)
  }
}

const schemaVersion = 1

/** 空库初始化；重复运行只校验版本，不覆盖旧数据，未知版本拒绝处理。 */
export async function migrateHosted(pool: Pool): Promise<void> {
  const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8')
  await transaction(pool, async (client) => {
    // 事务级锁防止两个维护进程同时初始化同一数据库。
    await client.query('SELECT pg_advisory_xact_lock(485183190513)')
    await client.query('CREATE SCHEMA IF NOT EXISTS rh_hosted')
    await client.query(`
      CREATE TABLE IF NOT EXISTS rh_hosted.migrations (
        version integer PRIMARY KEY
      )`)
    const current = await client.query<{ version: number }>(
      'SELECT version FROM rh_hosted.migrations',
    )
    if (current.rows.length) {
      assertVersion(current.rows)
      return
    }
    await client.query(sql)
    await client.query('INSERT INTO rh_hosted.migrations VALUES ($1)', [schemaVersion])
  })
}

/** 在线宿主只接受已显式迁移到受支持版本的数据库。 */
export async function assertHostedSchema(pool: Pool): Promise<void> {
  const result = await pool.query<{ version: number }>('SELECT version FROM rh_hosted.migrations')
  assertVersion(result.rows)
}

function assertVersion(rows: { version: number }[]) {
  if (rows.length !== 1 || rows[0]?.version !== schemaVersion)
    throw new Error('在线数据库版本不受支持')
}
