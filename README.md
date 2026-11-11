# Release Harbor

面向 React Native、Flutter 和原生应用的本机商店发布工作台。接收已有 APK／IPA／HarmonyOS APP，统一组织应用、商店账号、安装包、发布、审核跟踪和本机维护。

当前为本机单人版：第一至第四期工程范围、本地效率增强与本轮日常使用优化已接入。已有 Android／iOS 可用反馈；具体送审、定时生效、上架与通知投递仍按渠道和版本分别验收，不以本地测试替代。[第五期在线控制台](docs/plans/phase-5-hosted-console-plan.md)已开始规划，尚未实施；第六期团队自动化暂缓。

## 本地启动

需要 Node.js 24、pnpm 11.20.0；安全凭据存储目前支持 macOS。

```bash
pnpm install --frozen-lockfile
pnpm workbench
```

日常也可双击根目录 `启动 Release Harbor.command`。新实例自动构建并打开 http://127.0.0.1:4399；已有健康实例会复用。开发者使用 `pnpm dev`，页面为 http://127.0.0.1:5178，API 为 http://127.0.0.1:4399。也可 `pnpm build` 后运行 `pnpm start`，在 API 地址访问构建好的页面。服务仅监听回环地址，无在线认证，不直接开放公网。

默认数据根为 `~/.release-harbor`；设置 `RELEASE_HARBOR_DATA_DIR` 可指定隔离目录。恢复后的活动业务代由受控指针选择，不手工覆盖目录或删除 `.local` 保护文件。服务仅支持单进程写入，存储损坏拒绝覆盖。

## 功能与入口

| 菜单       | 当前用途                                                                                             |
| ---------- | ---------------------------------------------------------------------------------------------------- |
| 发布中心   | 单渠道发布、Android 同应用多商店串行批次、iOS 上传／已有构建送审／批准后手动发布；查看独立历史和回执 |
| 审核状态   | 按商店绑定直接查询官方状态，无需本机先发布；待办、跟踪任务、有限资料检查、查询历史及可选本地发布关联 |
| 应用管理   | 平铺应用与项目分组，新建配置向导，渠道配置、安装包与发布前检查                                       |
| 商店账号   | 页面配置、检查本机材料、更新凭据；更多操作中改名与保护删除                                           |
| 本机设置   | 存储、备份恢复、通知设置与运行诊断；通知记录在顶部查看                                               |
| 帮助与支持 | 查看已知问题、处理方法、渠道差异与产品进度                                                           |

发布中心为首页，首屏三个入口分别查看处理中、待确认与结果待核对。首次配置与启动详见[快速指南](docs/guides/workbench-quick-start.md)；完整操作步骤、界面截图和异常处理见[图文操作手册](docs/guides/user-manual.md)，也可直接打开[离线图文版](docs/guides/user-manual.html)阅读或打印。

应用选项带平台与项目归属。地址栏只保留菜单，例如 `?view=releases`；应用选择、页面筛选、详情和页签随当前浏览器历史项保存，刷新和前后退不会再次发起发布。GET 读取本机缓存，只有明确查询或已显式开启的只读跟踪才请求商店。

旧长链接仍可导入原应用和详情，并自动缩短；页面内部定位不写入 localStorage 或 sessionStorage。复制新的短地址到新标签页或其他浏览器时，只进入对应菜单首页，不猜测原应用或渠道；当前标签页仍可刷新恢复，并返回原列表筛选。

## 日常发版

1. 在应用管理登记 Android 包名、iOS Bundle ID 或 HarmonyOS 身份，并绑定渠道与账号。
2. 导入已有安装包，核对身份、版本、构建号和 SHA-256。单文件最大 256 MiB，原文件预算 2 GiB。检查通过只证明实际字节身份一致，不证明签名或商店资格。
3. 在发布中心选择应用与渠道，单选沿用单渠道计划、多选进入 Android 批次，填写更新说明和发布策略。安装包可在当前发布页上传。单渠道可从历史或常用模板带入配置；安装包与具体时间重新选择，旧检查和授权不复用。
4. 点击准备，系统只读检查并保存摘要；核对目标、账号、包、资料写入范围、真实动作和策略，明确确认一次后执行。
5. 分别查看上传、异步处理、草稿／更新／送审受理及审核／上架事实。结果不明先到商店核对并记录人工结论，不重放旧授权。

同版本重新打包不能绕过防重；未知结果继续阻塞目标。批次全局串行，华为 Android 批次仍只保存草稿；单渠道可明确选择正式送审。批次停止只取消尚未开始写入的目标，重启不续跑。

## 渠道范围

已接入华为 Android、小米、OPPO、vivo、魅族、荣耀、Apple、应用宝、华为鸿蒙。各渠道资料沿用与有限更新范围不同，完整图文和合规资料在官方后台维护。

- Android 支持立即／指定时间，魅族公开 API 缺定时字段，明确拒绝定时。OPPO／vivo 时间映射须核对后台实际效果。
- Apple 提供审核后自动／手动发布。上传、已有构建送审、批准后手动发布分别执行；本项目不开放定时。
- 小米仅查询公开在架，不提供新版本审核进度；应用宝审核结果无版本身份，不能关联某个新包。其他渠道也只按官方实际返回范围判断。

日常操作见[统一发布指南](docs/guides/release-orchestration.md)、[状态查询指南](docs/guides/release-status-observations.md)；各渠道真实待验项见[验收清单](docs/verification/local-productivity-acceptance-2026-11-08.md)。百度不在当前规划。

## 安装包、备份与跟踪

应用安装包页和本机设置的存储管理均可筛选、下载、批量清理原文件。下载核对实际摘要；清理前展示历史引用和影响，保留元数据、执行历史及防重保护。活动中的准备、检查或执行会阻止清理；清理后原计划可能失效，再次使用需导入并重新准备。

失败与原文件已清理的安装包还可单条或批量“删除记录”，确认后从安装包列表移除并清除残余文件。工作台读取及其他安装包的上传、检查或发布不阻止删除；备份恢复等独占维护期间须稍后再操作。已被计划引用的记录也可删除，原发布快照中的包身份、摘要、历史回执和防重保护保留；可用、接收中、检查中的记录不能直接删除。

备份包含白名单业务数据、非秘密元数据及发布模板，不含 Keychain/Vault、账号秘密、安装包原文件或原始日志。容器最大 32 MiB、未加密。每日备份默认关闭，自动副本保留最近七份；手动副本可显式批量删除。请定期下载到其他磁盘。

恢复先预览再确认，切换完整数据代并保留恢复前快照；旧授权退役、跟踪暂停，防重与未知保护不能回退。跨安装恢复只读，不自动获得发布资格。

审核详情显式开启只读跟踪，统一在“审核状态 → 跟踪任务”管理。服务退出或电脑休眠期间不执行；站内通知可持续记录，浏览器通知依赖页面运行与权限。运行诊断提供容量、工具、备份、任务状态与测试通知，不验证商店权限。详见[本机效率指南](docs/guides/local-efficiency.md)和[日常维护指南](docs/guides/local-productivity.md)。

## 账号与工具

账号材料仅在页面向导内存中临时持有，直接交给独立本机配置进程；普通 API 不代理秘密。保存只表示材料配置，商店权限由具体只读检查和实际动作验证。macOS Keychain 提示在系统窗口处理；CLI 保留 `pnpm credentials add`、`pnpm credentials list` 维护入口。

APK 需要 aapt／aapt2，可从 PATH、Android SDK 环境或默认 SDK 路径定位；IPA 需要 unzip 与 plutil，鸿蒙 APP 需要 unzip。实际 Apple 上传工具由可信执行器检查。秘密不进入日志、URL、普通合同或备份。

## 开发与验证

使用 React、TypeScript、Ant Design、NestJS + Fastify、单进程原子 JSON 存储；商店适配运行在可信 Node worker。Web 仅依赖公开合同，API 不加载 SDK 或解密材料。

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
pnpm test:smoke
```

测试使用临时目录、合成材料和替身网络。Chrome 冒烟截图保存在被忽略的 `artifacts/`，不替代真实商店验收。

人工与 AI 开发须遵守 [AGENTS.md](AGENTS.md)、[前端规范](docs/governance/frontend-code-standards.md)、[后端规范](docs/governance/backend-code-standards.md)。任务完成后按实际验证自动本地提交，远程推送须用户指令。

架构与领域见 [ARCHITECTURE](docs/ARCHITECTURE.md)、[CONTEXT](CONTEXT.md)；进度见[路线图](docs/ROADMAP.md)，本轮范围见[体验精简方案](docs/plans/workbench-usability-plan.md)，此前维护能力见[实施记录](docs/plans/local-productivity-plan.md)。旧首页说明移至[历史归档](docs/history/readme-before-local-productivity.md)，不作为当前能力说明。

工作台布局与视觉维护见[全站设计方案](docs/plans/workbench-design-plan.md)和[视觉系统](docs/design-system/MASTER.md)；手机筛选、发布卡片及账号维护入口见[快速使用指南](docs/guides/workbench-quick-start.md)。
