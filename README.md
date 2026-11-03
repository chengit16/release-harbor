# Release Harbor

面向 React Native、Flutter 和原生应用的独立商店发布工作台。产品接收已有安装包，统一组织项目、应用、渠道、产物、发布计划、执行记录和后续审核流程。

当前交付为 **0.1 产品基础骨架**：可运行的 Web 工作台、NestJS API、项目创建／列表／详情、本机持久化、渠道规划与六期路线。没有真实上传、送审或上线接口；上游 SDK 已隔离在后端适配包。

## 技术选型

- Web：React + TypeScript + Vite。
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

## 仓库结构

```text
apps/
  web/                  Web 工作台
  api/                  NestJS 控制面 API
packages/
  contracts/            公开合同
  domain/               项目与发布领域规则
  provider-app-ship/     商店 SDK 适配
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
- [在线部署演进](docs/DEPLOYMENT.md)
- [架构决策](docs/adr/0001-control-plane-and-execution.md)
- [调研来源](docs/RESEARCH.md)

当前 API 仅监听回环地址并拒绝非本机 Host／跨站 Origin；没有生产认证。在线部署是产品演进目标，不是把当前端口直接暴露公网。浏览器可选中的文件必须通过明确上传或受信任执行器交接，线上 API 不能读取用户电脑的本地路径。

本地 Git 仓库已建立。产品命名确定为 release-harbor；远程托管平台、账号、可见性和软件许可尚未指定，不自动推送或授予开源许可。
