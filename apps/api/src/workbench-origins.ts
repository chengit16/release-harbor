/** @description 集中定义工作台来源；普通业务支持部署指定的隧道，账号配置仍限定回环页面。 */
import type { WorkbenchTunnel } from '../../../scripts/workbench-tunnel.ts'

/** 独立凭据配置进程仅接受本机页面，不将公网来源传入材料录入协议。 */
export function credentialSetupOrigins(port: number): readonly string[] {
  return [
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    'http://127.0.0.1:5178',
    'http://localhost:5178',
  ]
}

/** 全局与业务门禁使用同一部署配置；隧道请求还须经过团队会话检查。 */
export function workbenchOrigins(port: number, tunnel?: WorkbenchTunnel): readonly string[] {
  const local = credentialSetupOrigins(port)
  return tunnel ? [...local, tunnel.origin] : local
}
