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

## 账号维护与鉴权提示修订（2026-11-03）

- 增加重新核对、名称编辑、原引用重新录入及确认删除；有绑定的账号由页面和服务端共同阻止删除，陈旧管理版本及旧替换能力会被拒绝。缺失材料、删除失败和进程中断都保留待核对状态。
- 新增 6 项账号维护测试，以及华为 HTTP 200 内含鉴权失败的回归场景。`pnpm typecheck`、`pnpm test`（48 项，无跳过）、`pnpm build`、`pnpm format:check` 和 `pnpm test:smoke` 均已通过。
- 已通过 `pnpm exec tsx scripts/check-keychain.mjs`：仅在随机 Keychain service 中使用合成长输入、中文、特殊字符和 Apple 加密私钥，完整读回后清理。未读取产品账号，未请求商店；常规自动测试仍使用内存安全库。
- 页面提示改为凭据无效或商店鉴权未通过，避免把 SDK `invalid_credentials` 一律描述为本地格式错误；华为向导明确 Client ID 来自 Connect API 客户端，不是 App ID。
- 用户另行请求的真实故障诊断确认：本机材料可读、字段存在且无首尾空格；华为鉴权返回 `203890688`，未取得访问令牌。仅在进程内比较发现 Client ID 与绑定的商店 App ID 相同，需用户重新录入正确客户端凭据。未输出或保存原始材料、令牌或上游消息，未进行应用查询、上传或提交审核。此失败诊断不计作真实商店预检通过验收。

本轮浏览器覆盖没有材料的待核对卡片、核对失败反馈、页面重新录入修复、核对通过、名称编辑、同引用更新、删除取消／确认、刷新持久化、关联删除禁用，以及桌面和窄屏布局；无页面运行时异常。截图位于忽略目录 `artifacts/credential-actions-mobile.png`、`artifacts/credential-delete-guard.png` 及既有向导截图。
