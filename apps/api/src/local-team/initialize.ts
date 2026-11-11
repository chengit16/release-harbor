/** @description 本机管理员首次初始化；可信终端输入口令，不通过参数、环境或 Web 提交。 */
import { homedir } from 'node:os'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'
import { CredentialPrompter } from '@release-harbor/runner-local'
import { DomainError } from '@release-harbor/domain'
import { LocalTeamStore, teamUsername } from './store.ts'

async function main(): Promise<void> {
  const [username, ...other] = process.argv.slice(2)
  if (!teamUsername(username) || other.length || !process.stdin.isTTY || !process.stdout.isTTY)
    throw new DomainError('请在本机交互终端运行 pnpm team:init <管理员登录名>')
  const root = resolve(process.env.RELEASE_HARBOR_DATA_DIR || join(homedir(), '.release-harbor'))
  const store = new LocalTeamStore(root)
  if (await store.read()) throw new DomainError('本机团队已经启用')
  const port = Number(process.env.RELEASE_HARBOR_PORT || 4399)
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new DomainError('端口必须为 1024–65535 的整数')
  const lock = createServer()
  // 持有将要使用的监听端口，避免默认工作台在初始化期间继续提供免登录服务。
  await new Promise<void>((done, reject) => {
    lock.once('error', () => reject(new DomainError('请先停止当前端口的本机工作台及转发')))
    lock.listen(port, '127.0.0.1', done)
  })
  try {
    const prompt = new CredentialPrompter(process.stdin, process.stdout)
    try {
      console.log('请确认其他使用同一数据目录的旧工作台及转发已停止。')
      const password = await prompt.ask('管理员密码', true)
      if (password !== (await prompt.ask('再次输入管理员密码', true)))
        throw new DomainError('两次密码不一致')
      await store.initialize(username, password)
      console.log('本机团队已启用。请启动新版工作台并使用管理员账号登录。')
    } finally {
      prompt.close()
    }
  } finally {
    lock.close()
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof DomainError ? error.message : '本机团队初始化未完成')
  process.exitCode = 1
})
