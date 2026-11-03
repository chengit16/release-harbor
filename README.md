# Release Harbor

面向 React Native、Flutter 和原生应用的独立商店发布工作台。产品接收已有安装包，统一组织项目、应用、渠道、产物、发布计划、执行记录和后续审核流程。

当前为 **0.1 第一期进行中**：Ant Design Web 工作台、NestJS API、项目与 Android／iOS 应用管理、华为／Apple 商店绑定、安装包接入与身份检查、本机商店账号页面配置及只读预检。商店绑定只保存公开目标与凭据引用，计划确认、向商店上传、送审和上线尚未实现；SDK 仅由可信 CLI 或独立本机 worker 使用。真实账号预检与商店发布尚未验收。

## 技术选型

- Web：React + TypeScript + Vite + Ant Design，常见交互优先使用 Ant Design 组件。
- API：NestJS + Fastify adapter，采用模块、依赖注入和 Controller／Service 分层。
- 领域与公开合同：独立工作空间包，便于 CLI、工作台和未来执行器复用。
- 本地存储：原子写入的单进程 JSON 实现；在线多实例部署前替换为有事务与唯一约束的数据库。
- 商店适配：锁定 @huoye/app-ship@0.3.0，运行在可信 Node 执行进程。

Node.js 是运行时，NestJS 是建立在它之上的服务端框架；Fastify 是 NestJS 选用的 HTTP adapter，三者可组合使用。

## 本地启动

需要 Node.js 24 和 pnpm 11.20.0。

```bash
pnpm install --frozen-lockfile
pnpm dev
```

打开 http://127.0.0.1:5178。API 在 http://127.0.0.1:4399，开发工作台通过同源代理访问 API。

构建后可由 API 一并提供静态工作台：

```bash
pnpm build
pnpm start
```

打开 http://127.0.0.1:4399。创建的项目默认保存到用户目录下 `.release-harbor/projects.json`。设置 `RELEASE_HARBOR_DATA_DIR` 可使用隔离目录，例如测试或演示数据；Node 默认不会自动加载 `.env`，需通过 shell 设置变量或启动时自行加载。

应用与商店绑定独立保存在同目录的 `applications.json`，不改写既有项目文件。服务只支持单进程写入；文件损坏或版本不受支持时拒绝覆盖。停止服务后可备份整个数据目录。进入项目后可登记应用和绑定商店目标；URL 保存项目／应用定位，刷新后可继续查看。

在应用详情切换“安装包”页签，选择已有 APK／IPA 后点击“上传并检查”。默认单文件最大 256 MiB，产物字节预算为 2 GiB，同一时间只接收／检查一个文件。文件与安全记录存于同目录 `artifacts/{UUID}/`，失败字节自动清除；中断记录在重启后标记失败，不自动重跑。首轮不提供成功产物的在线删除或下载入口。

APK 检查需要可用 aapt／aapt2，可通过 `ANDROID_HOME`、`ANDROID_SDK_ROOT` 或本机默认 SDK 路径定位；IPA 检查需要 unzip 与 plutil。缺少工具、包身份不符或文件损坏会显示真实失败。检查通过仅代表接收字节的身份、版本与摘要可核对，不代表签名、商店资格或发布成功。

## 商店账号与只读预检

打开左侧“商店账号”，点击“新增商店账号”，按“账号信息 → 配置材料 → 确认保存”完成配置。也可在应用的商店绑定表单中点击“新增账号”；保存后自动选中，已填写的商店 appId 保留，再点击“保存绑定”。日常录入无需终端或手写凭据引用。

账号名称由用户设置，内部 reference 自动生成；已由 CLI 创建的档案继续可选，默认显示原引用。支持华为 Connect API 的 Client ID／Client Secret，以及 Apple 团队 API Key 的 Issuer ID／Key ID／P-256 `.p8` 文件（不超过 64 KiB）。保存只表示本机材料已配置，鉴权及应用目标仍需显式预检。

本地启动会自动管理独立回环配置进程，页面通过五分钟会话直接提交材料；普通业务 API 不代理材料正文。凭据仅在向导内存临时持有，关闭或保存受理后清理输入，不缓存到浏览器。macOS 如弹出系统 Keychain 访问提示，请在系统窗口完成操作。

保存中关闭页面不会撤销已经开始的存储。网络超时后使用“查询本次保存结果”，或在商店账号中重新读取；不要重复录入。保存不明会保留待核对状态，不自动重放材料。账号标签与操作记录独立保存于 `credential-accounts.json`，不修改 SDK Vault 格式。

CLI 保留为维护入口。在仓库目录的 macOS 交互终端运行：

```bash
pnpm credentials add
pnpm credentials list
```

`add` 录入公开引用和商店类型，然后关闭秘密输入的回显；不接受密码或密钥命令参数，不覆盖已有引用。华为使用 Client ID／Client Secret，Apple 使用 Issuer ID／Key ID 和本机 `.p8` 私钥文件。首轮 Apple 档案用于只读查询，不代表已配置构建上传所需的全部凭据和工具。凭据轮换时新增引用，再修改商店绑定。

命令显示“凭据引用”后，输入自定名称（例如 `huawei-work`）并按回车；商店类型输入 `huawei` 或 `app_store`。标注“输入不回显”的字段不会显示输入字符，输入完成后直接按回车。按 Ctrl+C 可取消当前录入。

标量存入 service 为 `release-harbor` 的 macOS Keychain，文件凭据经 AES-GCM 加密后存入数据目录的 `credentials/profiles.json`；不扫描 SDK 默认凭据库。仅复制数据目录不能替代 Keychain 迁移。其他系统当前明确显示不支持安全存储。CLI 与服务须使用相同的 `RELEASE_HARBOR_DATA_DIR`。

应用详情进入“只读预检”，选择商店绑定及检查通过的安装包，然后显式运行；如目录已变化可重新读取。worker 重新复核字节和身份，只向对应商店发起鉴权与应用查询，不上传或送审。商店 appId 须为数字 ID。结果关联绑定版本、产物摘要及档案目录版本，有效五分钟；配置、文件、目录变化或环境不可用时失效。修改任一档案会保守地使旧结果失效；绕过 CLI 直接修改 Keychain 无法自动侦测，后续执行仍须再次核验。

记录独立保存于 `preflights.json`，重启后未完成项标记“无法验证／中断”，不重跑。预检通过只证明当次产物、鉴权和目标匹配，上传权限始终为“未验证”，也不构成发布授权。

## 仓库结构

```text
apps/
  web/                  Web 工作台
  api/                  NestJS 控制面 API
packages/
  contracts/            公开合同
  domain/               项目与发布领域规则
  provider-app-ship/     商店 SDK 适配
  runner-local/          可信 CLI、独立检查／只读预检进程与私有协议
scripts/                开发辅助
tests/                  领域和 API 合同测试
docs/                   产品、架构、路线和部署设计
```

## 验证

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
```

已安装 Google Chrome 的本机可额外运行 `pnpm test:smoke`；该检查使用独立端口和临时数据目录，验证真实浏览器创建、刷新持久化、导航和移动布局，并将截图保存到被忽略的 `artifacts/`。

## 产品与部署文档

- [产品定义](docs/PRODUCT.md)
- [领域术语](CONTEXT.md)
- [架构设计](docs/ARCHITECTURE.md)
- [完整路线图](docs/ROADMAP.md)
- [第一期实施计划](docs/plans/phase-1-implementation-plan.md)
- [页面内商店账号配置向导方案](docs/plans/credential-setup-wizard-plan.md)（P1-3A，本地工程已实现）
- [规格管理约定](openspec/README.md)
- [应用与商店绑定验收](openspec/changes/add-application-bindings/verification.md)
- [产物接入与检查验收](openspec/changes/add-artifact-intake/verification.md)
- [Profile 与只读预检验收](openspec/changes/add-readonly-preflight/verification.md)
- [在线部署演进](docs/DEPLOYMENT.md)
- [架构决策](docs/adr/0001-control-plane-and-execution.md)
- [调研来源](docs/RESEARCH.md)

## 开发规范

人工与 AI 开发均须遵守 [AGENTS.md](AGENTS.md)，修改前按范围阅读：

- [Web 前端代码规范](docs/governance/frontend-code-standards.md)：目录与组件职责、状态与 API、样式安全、中文注释和浏览器验证。
- [后端代码与注释规范](docs/governance/backend-code-standards.md)：NestJS 分层、公开合同、存储与执行边界、中文 JSDoc 和复杂流程注释。

涉及公开合同或跨端流程时两份均须阅读。规范对新增与实际修改的代码生效，历史内容按修改范围渐进调整；现有自动检查的覆盖范围以规范和实际脚本为准。

当前 API 仅监听回环地址并拒绝非本机 Host／跨站 Origin；没有生产认证。在线部署是产品演进目标，不是把当前端口直接暴露公网。浏览器可选中的文件必须通过明确上传或受信任执行器交接，线上 API 不能读取用户电脑的本地路径。

本地 Git 仓库已建立。产品命名确定为 release-harbor；远程托管平台、账号、可见性和软件许可尚未指定，不自动推送或授予开源许可。
