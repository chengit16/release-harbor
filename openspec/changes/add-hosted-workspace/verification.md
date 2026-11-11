# 验证记录

2026-11-11，P5-0／P5-1 使用独立 PostgreSQL 临时库、合成 HTTPS OIDC 服务和 Chrome 验证。未读取本机工作台的数据根或真实商店材料。

- `pnpm hosted:migrate` 在空库执行并可重复校验；`pnpm hosted:workspace` 能创建首个管理员，拒绝用相同空间标识覆盖已有数据。
- 在线专项 3 项通过：固定 HTTPS 来源；使用真实 OIDC 发现、授权码交换、S256 PKCE 和签名 ID Token 核对受邀身份；核对一次性回调、会话撤销、请求来源、两个空间的同标识项目、跨空间及错父级的拒绝、数据库复合外键、角色变化、最后管理员保护和绑定版本冲突。
- Chrome 在 1440 与 375 像素视口完成组织登录、项目创建、空间切换、成员添加、窄屏对齐和退出；切到只读空间不显示旧空间应用或管理入口。截图位于忽略目录 `artifacts/hosted-directory-desktop.png`、`artifacts/hosted-directory-mobile.png`。
- `pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm hosted:build`、`pnpm format:check` 通过。默认测试 303 项通过，未配置数据库时跳过 1 项；使用临时 PostgreSQL 单独执行该专项如上。
- `pnpm test:smoke` 本机工作台全量回归通过，包括本机备份、凭据、安装包、发布、审核查询与窄屏交互；未使用真实商店。

真实组织 IdP、托管域名、对象存储、执行器、真实商店动作均未验收。在线入口保持回环，试点公网部署及商店写入未开放。尚未运行 OpenSpec CLI。
