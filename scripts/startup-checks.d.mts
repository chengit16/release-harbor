/** @description 原生启动脚本的类型边界，供隔离测试校验只读探测参数。 */
/** 拒绝不符合 Node.js 24 的版本字符串。 */
export function checkNodeVersion(version?: string): void
/** 校验健康响应的产品、模式和本机空间身份。 */
export function isHarborService(
  origin: string,
  request?: (input: string, init?: RequestInit) => Promise<Response>,
): Promise<boolean>
/** 健康身份通过且 HTML 工作台可达时才允许打开浏览器。 */
export function isHarborWorkbench(
  origin: string,
  request?: (input: string, init?: RequestInit) => Promise<Response>,
): Promise<boolean>
/** 仅探测回环端口，已有监听时拒绝启动，不结束原进程。 */
export function assertPortAvailable(port: number): Promise<void>
