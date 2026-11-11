/** @description 显式迁移在线数据库或创建新空间的首位管理员，不导入本机数据。 */
import { DomainError } from '@release-harbor/domain'
import { configuredIssuer, requiredEnv } from './config.ts'
import { assertHostedSchema, hostedPool, migrateHosted } from './database.ts'
import { hostedSubject } from './identity.ts'
import { HostedSessions } from './session-store.ts'

async function main() {
  const [command, key, name, label, ...extra] = process.argv.slice(2)
  if (
    extra.length ||
    (command === 'migrate'
      ? Boolean(key || name || label)
      : command !== 'workspace' || !key || !name || !label)
  )
    throw new DomainError(
      '请运行 hosted:migrate 或 hosted:workspace <标识> <空间名称> <管理员显示名>',
    )
  const pool = hostedPool(requiredEnv('RELEASE_HARBOR_HOSTED_DATABASE_URL'))
  try {
    if (command === 'migrate') {
      await migrateHosted(pool)
      console.log('在线目录数据库迁移完成')
    } else if (key && name && label) {
      await assertHostedSchema(pool)
      const issuer = configuredIssuer(requiredEnv('RELEASE_HARBOR_HOSTED_OIDC_ISSUER'))
      const subject = hostedSubject(requiredEnv('RELEASE_HARBOR_HOSTED_BOOTSTRAP_SUBJECT'))
      await new HostedSessions(pool, issuer).bootstrap(key, name, subject, label)
      console.log(`已创建在线工作空间：${key}`)
    }
  } finally {
    await pool.end()
  }
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof DomainError ? error.message : '在线维护操作失败，请核对环境和数据库',
  )
  process.exitCode = 1
})
