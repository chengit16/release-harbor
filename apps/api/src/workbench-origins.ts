/** @description 集中定义工作台来源；普通业务沿用已指定隧道，敏感账号配置仍限定回环页面。 */

/** 独立凭据配置进程仅接受本机页面，不将公网来源传入材料录入协议。 */
export function credentialSetupOrigins(port: number): readonly string[] {
  return [
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    'http://127.0.0.1:5178',
    'http://localhost:5178',
  ]
}

/** 全局与业务门禁必须共用精确列表；来源校验不替代发布确认或在线认证。 */
export function workbenchOrigins(port: number): readonly string[] {
  return [
    ...credentialSetupOrigins(port),
    'https://6e03b6cd.r20.vip.cpolar.cn',
    'https://13231goev5981.vicp.fun',
  ]
}
