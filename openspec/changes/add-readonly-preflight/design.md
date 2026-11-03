# 凭据边界与预检设计

## 本机录入

`pnpm credentials add` 在交互终端中录入公开别名、渠道和秘密，秘密输入不回显，也不接受命令参数。支持华为 clientId／clientSecret、Apple Issuer ID／Key ID 与用户明确选择的 p8 文件。只允许新增，不静默覆盖已有档案。`pnpm credentials list` 仅显示公开元数据。

使用 SDK 的 LocalCredentialProfileStore，Keychain service 固定为 `release-harbor`，Vault 位于本项目数据目录 `credentials/profiles.json`，不扫描 SDK 默认账号库。标量放入 Keychain，文件内容采用 SDK 的 AES-GCM 加密；Web/API 不接收秘密或读取解密材料。macOS 之外明确显示当前环境不可用。开发与测试不读取真实 Keychain。

Profile 版本是 Vault 非秘密文件状态的摘要，不是密钥或材料的摘要；修改任一 Profile 会保守地使旧预检失效。绕过 CLI 手动修改 Keychain 无法自动侦测，因此结果只表达带时间事实，后续执行仍需重新核验。

## 执行与接口

新增本地私有 worker，只允许 `catalog` 和 `preflight`，任务通过 nonce 关联。预检同时限定应用、商店绑定、产物摘要与 Profile 版本，固定受控路径不能由浏览器指定。先重新检查实际文件，再解析指定档案、调用 SDK `preflightPublish`。HTTP 白名单只开放华为获取 Token／查询应用、Apple 查询应用；禁止重定向、重试和任何上传／送审接口。

- `GET /api/profiles`：安全目录和环境状态，不读取解密秘密。
- `POST /api/projects/:projectId/applications/:applicationId/preflights`：输入仅包含 bindingId、artifactId、expectedBindingRevision、expectedProfileRevision，接收后返回 202。
- `GET .../preflights`：当前应用的历史事实及动态失效状态。

先验证可信 local 上下文与全部父级归属；仅 ready 产物可预检。首批商店 appId 在预检前必须满足 SDK 数字 ID 约束，旧绑定中其他公开值可继续保存，但不能核验成功。单个预检服务只运行一条任务，不自动重试；进程限时 60 秒，SDK 网络查询限时 20 秒。

## 事实与失效

记录仅含公开上下文、版本、摘要、artifact/credentials/target 三项检查状态、固定结果码与时间。结果为 running、passed、failed、unverified，上传权限固定 not_verified；工具／网络／平台无法验证不能显示通过。

结果默认有效 5 分钟。绑定 revision 变化、产物状态／摘要变化、Profile 目录版本变化或无法读取目录，以及过期，均使历史结果显示“已失效”。查询不会重跑网络。用户必须重新显式触发，不能用旧结果批准新计划。

记录保存在独立 `preflights.json`，同进程串行原子写入，未知版本或损坏数据拒绝覆盖。重启时 running 变为 unverified/interrupted，不自动恢复请求；异步持久化失败使服务关闭入口并明确失败。

## Web

应用详情新增“只读预检”页签，沿用白色主题及 Ant Design。展示本机 Profile、绑定、可用产物和历史检查结果。用户显式选择目标后触发，明确提示将访问对应商店的鉴权／只读接口；无档案、旧版本、失效或不确定状态均保留真实原因。不在页面中设置密码、私钥输入框。
