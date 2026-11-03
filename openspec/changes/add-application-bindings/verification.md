# 应用与商店绑定验收记录

**日期：**2026-11-03  
**范围：**第一期 P1-0／P1-1，以及用户追加的现有页面 Ant Design 优化。

## 交付结果

- 已建立规格约定与[SDK 静态核对记录](../../../docs/verification/sdk-baseline-2026-11-03.md)。
- 应用身份与商店 appId 分离；Android／华为、iOS／Apple 分别维护，可信工作空间由 API 注入。
- 版本化 `applications.json` 独立于旧项目文件，读写保护归属、唯一性、revision 和损坏数据。
- Ant Design `6.6.8` 固定版本及锁文件；统一中文主题、表单、导航、项目卡片、渠道表格和路线步骤条。
- 页面按需加载，构建后单个输出 JS 均小于 500 kB，消除了本轮引入组件库后的大块输出警告；不将构建体积等同于真实性能基准。

## 工程验证

| 检查                | 结果                                                                             |
| ------------------- | -------------------------------------------------------------------------------- |
| `pnpm typecheck`    | 已通过。                                                                         |
| `pnpm test`         | 已通过，共 11 项，包括原有项目测试与新增身份、并发、隔离、损坏保护和 HTTP 合同。 |
| `pnpm build`        | 已通过。                                                                         |
| `pnpm format:check` | 已通过。                                                                         |
| `pnpm test:smoke`   | 已通过真实 Chrome 检查。                                                         |

浏览器覆盖项目创建／刷新、Android 和 iOS 创建、独立商店目标、重复身份失败保留草稿、绑定版本冲突、刷新后显式核对版本、导航后退、取消恢复焦点，以及项目／应用／渠道／路线图在 390px 下无横向溢出。没有未处理页面异常。

本地截图保存在被忽略的 `artifacts/`：`workspace-empty.png`、`workspace.png`、`application-desktop.png`、`application-mobile.png`、`channels-desktop.png`、`channels-mobile.png`、`roadmap-desktop.png`、`roadmap-mobile.png` 和 `workspace-mobile.png`；截图仅含合成数据。

## 未实现与未验收

P1-2 至 P1-5 的产物、凭据预检、计划／授权、执行器和真实渠道仍待实施。没有读取真实凭据，没有执行上传、送审或上线；绑定保持 `not_checked`，发布能力保持关闭。OpenSpec CLI 校验未运行。
