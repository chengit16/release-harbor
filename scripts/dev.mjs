import { spawn } from 'node:child_process'
const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const children = [
  spawn(command, ['--filter', '@release-harbor/api', 'dev'], { stdio: 'inherit' }),
  spawn(command, ['--filter', '@release-harbor/web', 'dev'], { stdio: 'inherit' }),
]
let stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) child.kill('SIGTERM')
  process.exitCode = code
}
for (const child of children) {
  child.on('error', (error) => {
    console.error('开发进程启动失败：', error.message)
    stop(1)
  })
  child.on('exit', (code) => {
    if (!stopping) stop(code || 1)
  })
}
process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())
