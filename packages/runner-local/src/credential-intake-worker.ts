/** @description 本机配置进程入口，私有 IPC 只承载配置、会话控制与安全回报，材料只从独立 HTTP 接收。 */
import { isAbsolute, join } from 'node:path'
import {
  isRecord,
  isCredentialAccountAction,
  isCredentialReplacement,
} from '@release-harbor/contracts'
import { localCredentialRepository } from '@release-harbor/provider-app-ship'
import { CredentialAccountStore } from './credential-account-store.ts'
import { CredentialIntakeEngine, CredentialIntakeError } from './credential-intake-engine.ts'
import { CredentialIntakeServer } from './credential-intake-server.ts'

let engine: CredentialIntakeEngine | null = null
let server: CredentialIntakeServer | null = null
let origins: string[] = []
let initializing = false

async function shutdown(): Promise<void> {
  const timer = setTimeout(() => process.exit(1), 3000)
  timer.unref()
  await server?.close().catch(() => undefined)
  process.exit(0)
}

process.on('disconnect', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
process.on('message', async (message: unknown) => {
  if (
    !isRecord(message) ||
    Object.keys(message).length !== 4 ||
    message.schemaVersion !== 1 ||
    typeof message.id !== 'string' ||
    !/^[a-f0-9-]{36}$/.test(message.id) ||
    !isRecord(message.input)
  )
    return
  const reply = (
    result: unknown,
    error: { message: string; statusCode: number } | null = null,
  ): void => {
    if (process.connected) process.send?.({ schemaVersion: 1, id: message.id, result, error })
  }
  try {
    const input = message.input
    if (message.action === 'initialize') {
      if (
        engine ||
        initializing ||
        Object.keys(input).length !== 2 ||
        typeof input.root !== 'string' ||
        !isAbsolute(input.root) ||
        !Array.isArray(input.origins) ||
        !input.origins.length ||
        !input.origins.every(
          (o) => typeof o === 'string' && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(o),
        )
      )
        throw new Error('无效启动')
      initializing = true
      origins = input.origins
      engine = new CredentialIntakeEngine(
        new CredentialAccountStore(join(input.root, 'credential-accounts.json')),
        localCredentialRepository(join(input.root, 'credentials', 'profiles.json')),
      )
      server = new CredentialIntakeServer(engine, origins)
      await server.start()
      reply({ ready: true })
    } else {
      if (!engine || !server) throw new Error('服务未启动')
      if (message.action === 'accounts' && Object.keys(input).length === 0)
        reply(await engine.accounts())
      else if (message.action === 'manage' && isCredentialAccountAction(input))
        reply(await engine.manage(input))
      else if (
        message.action === 'session' &&
        (Object.keys(input).length === 2 ||
          (Object.keys(input).length === 3 && isCredentialReplacement(input.replacement))) &&
        (input.channel === 'huawei' ||
          input.channel === 'app_store' ||
          input.channel === 'xiaomi' ||
          input.channel === 'oppo' ||
          input.channel === 'vivo' ||
          input.channel === 'meizu' ||
          input.channel === 'honor' ||
          input.channel === 'tencent' ||
          input.channel === 'harmony') &&
        typeof input.origin === 'string' &&
        origins.includes(input.origin)
      )
        reply(
          await engine.createSession(
            input.channel,
            input.origin,
            server.endpoint,
            isCredentialReplacement(input.replacement) ? input.replacement : undefined,
          ),
        )
      else if (
        message.action === 'operation' &&
        Object.keys(input).length === 1 &&
        typeof input.operationId === 'string' &&
        /^[a-f0-9-]{36}$/.test(input.operationId)
      )
        reply(await engine.operation(input.operationId))
      else throw new Error('无效动作')
    }
  } catch (error) {
    reply(
      null,
      error instanceof CredentialIntakeError
        ? { message: error.message, statusCode: error.statusCode }
        : { message: '本机账号配置服务暂不可用，请检查存储后重启', statusCode: 503 },
    )
  }
})
