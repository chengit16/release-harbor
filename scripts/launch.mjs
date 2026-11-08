/** @description 本机工作台统一启动入口，复用健康实例或构建后启动服务；不接触商店账号和发布授权。 */
import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import {
  checkNodeVersion,
  assertPortAvailable,
  isHarborService,
  isHarborWorkbench,
} from './startup-checks.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const port = Number(process.env.RELEASE_HARBOR_PORT || 4399)
const origin = `http://127.0.0.1:${port}`
function command(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(pnpm, args, { cwd: root, stdio: 'inherit' })
    child.once('error', () =>
      reject(Error('未找到 pnpm。请先安装项目指定的 pnpm 11，再重新启动。')),
    )
    child.once('exit', (code) =>
      code === 0
        ? resolve()
        : reject(Error(`本机命令执行未完成（退出码 ${code}），请根据上方提示处理后重新启动。`)),
    )
  })
}
function openPage(url, owned = false) {
  console.log(
    `工作台地址：${url}。${owned ? '关闭此终端将停止本次启动的服务。' : '现有服务继续运行。'}`,
  )
  if (process.env.RELEASE_HARBOR_NO_OPEN === '1') return
  const binary =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const child = spawn(binary, process.platform === 'win32' ? ['/c', 'start', '', url] : [url], {
    stdio: 'ignore',
  })
  child.on('error', () => console.log('未能自动打开浏览器，请访问上方工作台地址。'))
}
async function start() {
  // 1. 先检查工具和产品身份；已运行时只打开页面，不产生第二个数据写进程。
  checkNodeVersion()
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw Error('RELEASE_HARBOR_PORT 必须为 1024–65535 的整数。')
  if (await isHarborService(origin)) {
    const page =
      port === 4399 && (await isHarborWorkbench('http://127.0.0.1:5178'))
        ? 'http://127.0.0.1:5178'
        : origin
    if (!(await isHarborWorkbench(page)))
      throw Error(
        '本机 API 已运行，但工作台页面未就绪。请在原启动终端检查前端服务，或停止原实例后重新启动。',
      )
    console.log('已找到正在运行的 Release Harbor，复用现有实例。')
    openPage(page)
    return
  }
  await assertPortAvailable(port)
  // 2. 依赖安装是用户可见的首次步骤；不自动联网安装或更改软件版本。
  await access(new URL('../node_modules/.bin/tsx', import.meta.url)).catch(() => {
    throw Error('尚未安装项目依赖。请在项目目录执行 pnpm install，然后重新双击启动。')
  })
  console.log('正在核对依赖并构建当前工作台…')
  await command(['build'])
  // 3. 服务就绪后才打开页面；超时或中断只停止本次创建的子进程。
  const child = spawn(process.execPath, ['--import', 'tsx', 'apps/api/src/main.ts'], {
    cwd: root,
    stdio: 'inherit',
  })
  let stopped = false
  let failure
  let requestedStop = false
  const stop = () => {
    requestedStop = true
    stopped = true
    child.kill('SIGTERM')
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  const exited = new Promise((resolve) => {
    child.once('error', (error) => {
      failure = error
      stopped = true
      resolve()
    })
    child.once('exit', (code) => {
      stopped = true
      process.exitCode = requestedStop ? 0 : (code ?? 1)
      resolve()
    })
  })
  const deadline = Date.now() + 30000
  while (!stopped && Date.now() < deadline) {
    if (await isHarborWorkbench(origin)) {
      openPage(origin, true)
      await exited
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  if (!stopped) {
    stop()
    throw Error('服务未在三十秒内就绪，请查看上方错误提示。')
  }
  await exited
  if (failure) throw failure
}
start().catch((error) => {
  console.error(`启动未完成：${error.message}`)
  process.exitCode = 1
})
