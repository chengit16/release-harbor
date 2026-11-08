/** @description 统一启动前的只读本机检查；不安装软件、不修改系统配置、不结束占端口的其他进程。 */
import { createServer } from 'node:net'

/** 项目固定的工具版本；不兼容时给出可操作指引。 */
export function checkNodeVersion(version = process.versions.node) {
  if (Number(version.split('.')[0]) !== 24)
    throw Error('请先安装 Node.js 24，再重新启动 Release Harbor。')
}

/** 验证同一产品的本机健康响应，不把任意 HTTP 200 当成可复用实例。 */
export async function isHarborService(origin, request = fetch) {
  try {
    const result = await request(`${origin}/api/health`, {
      signal: AbortSignal.timeout(1500),
      redirect: 'error',
    })
    if (!result.ok) return false
    const data = await result.json()
    return (
      data.product === 'release-harbor' && data.mode === 'local' && data.workspaceId === 'local'
    )
  } catch {
    return false
  }
}

/** 检查页面是否随健康服务可达，避免打开只有 API 的空页面。 */
export async function isHarborWorkbench(origin, request = fetch) {
  if (!(await isHarborService(origin, request))) return false
  try {
    const result = await request(origin, { signal: AbortSignal.timeout(1500), redirect: 'error' })
    return (
      result.ok &&
      (result.headers.get('content-type') ?? '').includes('text/html') &&
      (await result.text()).includes('Release Harbor')
    )
  } catch {
    return false
  }
}

/** 端口被占时拒绝另开实例；只临时绑定回环地址进行探测。 */
export function assertPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', () =>
      reject(
        Error(`本机端口 ${port} 已被占用。请检查正在运行的程序；启动器不会自动结束其他进程。`),
      ),
    )
    server.listen(port, '127.0.0.1', () =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  })
}
