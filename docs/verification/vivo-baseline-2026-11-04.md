# vivo 接口核对记录

核对日期：2026-11-04。适配固定 `@huoye/app-ship@0.3.0` 的安全库，正式网络协议由本产品 provider 独立实现；API 和 Web 不加载 SDK。

## 官方依据

本次从中国开放平台公开文档目录及详情接口读取正文，无登录请求、账号鉴权或商店写入。全球开发者站点属于另一网关，不混用。

| 依据                                                           | 本次结论                                                                                                                                |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| [API 服务申请](https://dev.vivo.com.cn/documentCenter/doc/326) | 管理中心 → 账号管理 → API 管理，开通传包后取得 access_key／access_secret；不是推送凭据                                                  |
| [API 接入说明](https://dev.vivo.com.cn/documentCenter/doc/327) | 正式网关固定 developer-api.vivo.com.cn；毫秒时间戳；原值 ASCII 排序 HMAC-SHA256，之后编码；文件不参与签名                               |
| [查询详细信息](https://dev.vivo.com.cn/documentCenter/doc/346) | app.query.details 按 packageName 查询；读取类型、上架／审核状态、版本号与兼容设备                                                       |
| [APK 上传](https://dev.vivo.com.cn/documentCenter/doc/332)     | app.upload.apk.app，multipart/form-data；packageName、file、fileMd5；返回流水号、解析包名、版本和 MD5                                   |
| [同步更新](https://dev.vivo.com.cn/documentCenter/doc/343)     | app.sync.update.app；必需包名、构建号、APK 流水号、MD5、onlineType、compatibleDevice；现有其他资料为可选，不发送查看 URL 冒充附件流水号 |
| [参数字典](https://dev.vivo.com.cn/documentCenter/doc/344)     | appType=1 普通应用；status=2 待审核；saleStatus=1 已上架；onlineType=1 实时、2 定时                                                     |
| [公共返回码](https://dev.vivo.com.cn/documentCenter/doc/330)   | 区分鉴权／权限、限流／日限额、账号状态，code 与 subCode 同时核对                                                                        |

## 能力取舍

当前 SDK 上传器固定 onlineType=1、compatibleDevice=1，并仅验证上传流水号，无法完整满足本项目的冻结策略、设备范围复用和回执匹配，因此不直接调用其 upload。业务字段页仍有旧 hmac 字样，总接入说明与 Java 示例为 HMAC-SHA256；使用后者，不因失败切换签名算法或重传。

首批只接入已上架普通应用单 APK 更新；目标须明确非草稿、非待审，缺失必需来源拒绝而不猜默认值。游戏、首次创建、分包、分阶段和地址下载方式留待单独切片。构建号限制正整数且递增，采用接口 Integer 范围；更新说明为 5–200 字。

定时意图公开保存 UTC，按中国标准时间 Asia/Shanghai 转为 `scheOnlineTime` 的无时区文本。官方字段说明明确格式，但未明示时区；这是本次工程映射，需在真实后台核对，不能宣称真实定时已验收。

同步接口的明确成功表示平台接收更新；不推断审核完成、定时设置已在后台生效或已经上架。单次上传及单次同步更新均无重试；任何许可后异常须人工核对。

## 验证边界

隔离自动测试覆盖签名、来源、两种上架类型、许可、回执匹配、固定错误分类、未知结果及实际 APK 独立执行。Chrome 覆盖实际账号向导、绑定、准备、一次确认及刷新；结果由隔离夹具提供，不请求商店。命令结果见 [实施验收](../../openspec/changes/add-vivo-release/verification.md)。真实验收待用户在明确账号、计划和产物上显式执行。
