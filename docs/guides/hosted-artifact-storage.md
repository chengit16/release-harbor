# 在线安装包直传（P5-2）

在在线控制台选择“项目与应用 → 安装包”。管理员和发布操作员可选择 APK、开始上传、暂停、续传、取消和下载；查看者只读。管理员可清理未被引用的已接收原文件，记录会保留。只有对象版本和大小核对完成后才显示“待检查”；包名、版本、签名和可信整包 SHA-256 需要后续执行器核验。

- 每个文件最多 256 MiB，每空间保留上限 2 GiB，包含未结束的上传和已接收原文件。使用 8 MiB 分片，最后一片可较小。
- 中断后点击“继续上传”，重新选择相同 APK。控制面核对清单和存储里的真实分片，只补缺少的部分。关闭弹窗、刷新、切换应用或空间只停止本页等待，不取消服务端记录。
- 接收期限 24 小时，过期不能再领签名；已接收原文件默认保留 30 天。启用存储的在线进程每 15 分钟处理有界回收批次，失败或有引用保护时保留原文件与配额。进程停机期间不会运行回收；页面打开和刷新只读目录。

## 启用对象存储

先按[在线目录指南](hosted-workspace-validation.md)配置 PostgreSQL、OIDC 和回环 HTTPS 入口，再运行 `pnpm hosted:migrate`。迁移保留版本 1 的成员与目录，增加在线产物表。对象存储的环境变量须全设或全不设；全不设时在线目录仍可用，安装包页面只展示记录和配置提示。

| 环境变量                                     | 用途                                              |
| -------------------------------------------- | ------------------------------------------------- |
| `RELEASE_HARBOR_HOSTED_S3_ENDPOINT`          | 浏览器与在线宿主可访问的固定 HTTPS 来源，不带路径 |
| `RELEASE_HARBOR_HOSTED_S3_BUCKET`            | 本环境独立私有桶，必须开启版本控制                |
| `RELEASE_HARBOR_HOSTED_S3_REGION`            | 对象存储签名区域                                  |
| `RELEASE_HARBOR_HOSTED_S3_ACCESS_KEY_ID`     | 在线宿主使用的专用访问标识                        |
| `RELEASE_HARBOR_HOSTED_S3_SECRET_ACCESS_KEY` | 仅注入在线宿主的存储密钥                          |

启动前核对桶的以下行为：

- 关闭匿名读写，后端身份仅获得桶版本检查，以及固定 `release-harbor/hosted/v1/` 前缀下的分片、完成、读回、版本下载和版本删除权限。对缺失对象的读回应能区分不存在与拒绝访问。浏览器不取得这组访问密钥。
- 允许控制台的精确 HTTPS 来源对桶发送跨源 PUT，允许 `x-amz-checksum-sha256` 和 `Content-Type` 请求头。客户端不依赖 ETag 暴露头；控制面通过存储接口核对分片。反向代理要保留签名的 Host、查询参数和请求字节。
- 对该前缀设置未完成 multipart 的生命周期，建议不少于 2 天，以回收创建中断且未入库的孤立分片。不要对已完成版本设置无条件到期删除，避免绕过引用保护。
- 所选服务应通过 [S3 分片完整性](https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity-upload.html)所述的分片 SHA-256、列出分片和条件完成，并能读取、下载及删除指定版本。兼容性以实际环境验收为准。

每片短期签名最长 5 分钟、下载签名 2 分钟。撤销成员后不能再领取新签名；已发出的能力可能仍可用到期。服务端不会转发安装包字节、把签名写入日志或把凭据材料放进浏览器。

## 重跑隔离验收

先构建 `pnpm hosted:build`。使用隔离的 PostgreSQL 测试账号、回环测试对象存储及已开启版本控制的专用测试桶。以下变量只用于测试夹具，测试代理使用临时 TLS 和精确来源 CORS：

- `RELEASE_HARBOR_HOSTED_TEST_DATABASE_URL`
- `RELEASE_HARBOR_HOSTED_TEST_BROWSER=1`
- `RELEASE_HARBOR_HOSTED_TEST_S3_ENDPOINT`：回环 HTTP 地址，例如 `http://127.0.0.1:9000`
- `RELEASE_HARBOR_HOSTED_TEST_S3_BUCKET`
- `RELEASE_HARBOR_HOSTED_TEST_S3_ACCESS_KEY`
- `RELEASE_HARBOR_HOSTED_TEST_S3_SECRET_KEY`

执行 `pnpm exec tsx --test tests/hosted-artifacts.test.ts`。仅使用合成字节，测试桶不得指向任何业务数据；如果专项中断，清理该隔离环境中的测试对象和 multipart。真实云环境、执行器与商店动作不在此次工程验收范围。
