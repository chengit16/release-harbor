# 已核验的上游依据

核验日期：2026-11-02。用于冻结初始设计背景，不代表当前产品已完成真实商店验收。

## Flu 生态版本

Flu 主仓各组件独立发版：核验 main 提交 3e774a36aa2dfba8fbd0aa0515ef3720c40da249 时，CLI 源码 2.3.0、core 1.3.0、VSCode 插件 0.4.3；CLI npm latest 为 2.2.0。core 重新导出独立 @huoye/app-ship，依赖 ^0.3.0，主仓不包含该包源码。

- [主仓固定提交](https://gitee.com/flu-cli/flu-cli/tree/3e774a36aa2dfba8fbd0aa0515ef3720c40da249)
- [Core 依赖](https://gitee.com/flu-cli/flu-cli/blob/3e774a36aa2dfba8fbd0aa0515ef3720c40da249/packages/core/package.json)
- [独立引擎元数据](https://registry.npmjs.org/@huoye%2Fapp-ship/latest)
- [0.3.0 已发布源码](https://unpkg.com/@huoye/app-ship@0.3.0/dist/index.js)
- [0.3.0 README](https://unpkg.com/@huoye/app-ship@0.3.0/README.md)

## 发布能力与限制

0.3.0 导出 inspectReleaseArtifact、createReleasePlan 和 executeReleasePlan(s)。包身份可从真实文件取得；计划／确认执行路径与底层 UploadManager 的能力不同。适配器应对明确产物、目标和动作负责，不通过直接调用底层上传器绕过确认。

默认凭据提供器仅验证 macOS Keychain，无头 CI 未经验证。华为 submit 路径存在上游结果偏差，首期只采用草稿；Apple 适配器只上传构建，不自动完成选构建、送审和上线，API-Key-only 上传也未被证明可用。

插件 0.4.3 已支持非 Flutter 目录、仅上传、确认、记录、真实渠道并发队列及部分审核状态查询。可参考并复用经过确认的接口思路，不将插件源码功能自动当作 SDK 公开能力。

## Web 与服务端

- [NestJS 入门](https://docs.nestjs.com/first-steps)：TypeScript 服务端框架与模块组织。
- [NestJS Providers](https://docs.nestjs.com/providers)：依赖注入及服务职责。
- [NestJS Fastify adapter](https://docs.nestjs.com/techniques/performance)：HTTP 底层可选择 Fastify。
- [Vite 指南](https://vite.dev/guide/)：开发与静态资源构建。

初始依赖的确切版本见各 package.json 和 pnpm-lock.yaml。后续升级需重新核对真实导出、动作、凭据和执行结果语义，不只依据主仓标题或宣传文档。
