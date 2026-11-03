# P1-3A 本地工程验收

**日期：**2026-11-03。  
**范围：**已实现独立本机配置进程、短期会话、安全保存意图、商店账号页、三步向导、绑定选择与自动回填。

- 方案、排期及 OpenSpec 文档中的本地文件链接检查通过。
- `pnpm typecheck`、`pnpm test`（41 项通过，无跳过）、`pnpm build`、`pnpm format:check` 通过。
- `pnpm test:smoke` 通过。真实 Chrome 验证华为／Apple 页面录入、三步向导、保存后回填、账号目录、取消、绑定版本冲突、产物上传、只读预检失败反馈及桌面／390px 窄屏；账号保存与预检结果分别展示，没有模拟商店成功。
- 核对了华为 API 客户端、Apple API Key 和 OWASP 来源校验的官方说明，引用见完整方案。
- 新增 9 项后端验收，覆盖真实回环 HTTP、来源／Host／令牌、过期、字段白名单、大小、重名、重复保存、受理中取消竞争、SDK 故障、待核对、损坏保护、旧 CLI 档案及私有 IPC 进程启动／关闭。
- 浏览器材料请求仅能发往独立回环配置服务；检查控制面请求及浏览器存储中无合成秘密。SDK 使用真实加密 Vault 配合显式内存 SecretStore；生产入口没有模拟开关。
- 截图保存在被忽略的 `artifacts/credential-wizard-desktop.png`、`credential-wizard-mobile.png` 和 `credential-accounts-desktop.png`。
- 未访问真实凭据、写入真实 Keychain 或调用真实商店。真实录入及渠道核验仍待单独验收；页面向导中的系统钥匙串授权需用户在本机完成。
- 当前未安装 OpenSpec CLI，未执行或宣称通过其命令校验。
