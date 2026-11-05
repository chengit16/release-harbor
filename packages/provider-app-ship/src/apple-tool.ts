/** @description 固定 Apple 工具的进程边界；帮助探测兼容两个输出流，上传输出一律丢弃。 */
import { execFile } from 'node:child_process'

/** 可信工具调用端口；参数来自 provider，不接收网页命令或路径配置。 */
export type AppleToolRunner = (
  args: readonly string[],
  env: NodeJS.ProcessEnv,
) => Promise<{ ok: boolean; stdout: string }>

/** 仅用于受控进程测试的启动端口；原始工具输出不得离开本模块。 */
export type AppleToolCommand = (
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  done: (error: Error | null, stdout: string, stderr: string) => void,
) => void

const command: AppleToolCommand = (args, env, done) => {
  execFile(
    '/usr/bin/xcrun',
    [...args],
    {
      env,
      cwd: env.HOME,
      encoding: 'utf8',
      timeout: args.includes('--help') ? 15000 : 29 * 60 * 1000,
      maxBuffer: 1024 * 1024,
    },
    done,
  )
}

/** 只在无网络的帮助探测合并输出；上传成功仍由退出码判断，绝不以帮助文本掩盖错误退出。 */
export function createAppleToolRunner(execute: AppleToolCommand = command): AppleToolRunner {
  return (args, env) =>
    new Promise((resolve) => {
      execute(args, env, (error, stdout, stderr) => {
        // altool --help 在部分 Xcode 版本向 stderr 输出且退出码为 0；
        // 仅此固定探测允许读取 stderr，上传的正文、警告及错误全部丢弃。
        resolve({
          ok: !error,
          stdout:
            args.length === 2 && args[0] === 'altool' && args[1] === '--help'
              ? `${stdout}\n${stderr}`
              : '',
        })
      })
    })
}
