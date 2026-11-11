# 在线目录验证（P5-1）

在线目录是第五期的隔离验证入口。受邀成员可登录、切换工作空间，管理员可维护成员、项目、Android 应用和华为 AppGallery 绑定。发布操作员和查看者只能读取应用与绑定目录；P5-2 配置存储后，发布操作员也能上传安装包，详见[直传指南](hosted-artifact-storage.md)。绑定显示“未核验”，不会请求商店。执行器与发布仍未接入。

## 环境

- 使用独立 PostgreSQL 数据库。迁移身份需要在该库建立 `rh_hosted` schema；验证宿主只需该 schema 下表的业务读写权限，不在启动时迁移。不指向本机工作台数据或已有生产数据库。
- 使用组织 OIDC 的服务端客户端，配置授权码、S256 PKCE、`client_secret_post` 和可验证签名的 ID Token。发行者必须和发现文档的 `issuer` 完全一致。为客户端登记固定回调 `https://<验证域名>/api/hosted/auth/callback`。
- 在线宿主只监听回环地址，默认端口 4408。若在受控验证环境通过 HTTPS 转发，保持原始在线 Host，Web 与 API 使用同一来源。没有提供公网生产部署；真实 IdP、托管域名和远端操作还未验收。

| 环境变量                                   | 用途                                               |
| ------------------------------------------ | -------------------------------------------------- |
| `RELEASE_HARBOR_HOSTED_DATABASE_URL`       | 独立 PostgreSQL 连接；远程数据库按部署要求校验 TLS |
| `RELEASE_HARBOR_HOSTED_ORIGIN`             | 精确 HTTPS 来源，不带路径、查询或片段              |
| `RELEASE_HARBOR_HOSTED_OIDC_ISSUER`        | OIDC 发行者，精确匹配元数据                        |
| `RELEASE_HARBOR_HOSTED_OIDC_CLIENT_ID`     | IdP 分配给在线控制台的客户端                       |
| `RELEASE_HARBOR_HOSTED_OIDC_CLIENT_SECRET` | 服务端客户端密钥；仅注入在线进程，不进入 Web 构建  |
| `RELEASE_HARBOR_HOSTED_PORT`               | 可选回环端口，默认 4408                            |

## 初始化与登录

1. 配置在线环境后执行 `pnpm hosted:migrate`。同版本可重复检查；数据库未迁移或版本不匹配时，宿主拒绝启动。
2. 将 IdP 为此客户端返回的首位管理员 subject 注入维护命令的 `RELEASE_HARBOR_HOSTED_BOOTSTRAP_SUBJECT`，执行 `pnpm hosted:workspace pilot-team "试点工作空间" "首位管理员"`。该命令只创建新空间，重复标识返回冲突，不修改既有成员。
3. 执行 `pnpm hosted:build` 和 `pnpm hosted:start`。从已配置的 HTTPS 来源进入，通过组织身份登录。
4. 在“成员”中按 IdP 返回的准确 subject 添加成员，再在“项目与应用”维护目录。保存绑定只登记数字 App ID 和执行器账号别名，请勿填写商店密钥。移除成员或修改角色后，下一次请求按新权限处理。

退出会撤销 Release Harbor 当前会话。组织身份提供方可能仍保留其自身登录态；这两种会话分别管理。

## 工程验收

普通 `pnpm test` 不连接真实数据库，未设置在线测试数据库时会跳过在线集成用例。要验收本切片，使用能创建和删除测试库的 PostgreSQL 账号，先构建在线 Web，再执行：

```bash
pnpm hosted:build
RELEASE_HARBOR_HOSTED_TEST_DATABASE_URL='<隔离的测试连接>' \
  RELEASE_HARBOR_HOSTED_TEST_BROWSER=1 \
  pnpm exec tsx --test tests/hosted-workspace.test.ts
```

测试创建随机命名的新库并在结束后删除；临时 HTTPS IdP、签名密钥、用户身份和目录均为合成数据。运行浏览器验证需本机 Chrome 和用于生成测试证书的 OpenSSL。验收范围见 [OpenSpec](../../openspec/changes/add-hosted-workspace/verification.md)。
